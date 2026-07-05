# Software Stack Research — AI-Controlled Hydroponic Herb Garden

Research date: 2026-07-04. Target platform: Raspberry Pi 4/5 + camera(s) + relays, Telegram
as the user interface, Claude API for vision/decisions.

**Bottom line:** build a small custom Python service that calls the Claude API, talk to
Telegram with `python-telegram-bot`, and drive the hardware either directly via GPIO or —
if you want a polished dashboard, PID loops, and camera handling for free — on top of
**Mycodo**. Do **not** use OpenClaw as the brain: it is a general-purpose personal-assistant
gateway that is heavy on a Pi and gives broad system access you don't want on an
internet-exposed appliance. Estimated Claude API cost with Haiku: **~$3–7/month**.

---

## 1. OpenClaw as the "brain"

OpenClaw (openclaw.ai) is the open-source personal AI agent formerly called Clawdbot, then
Moltbot — renamed after an Anthropic trademark complaint. Created by Peter Steinberger
(PSPDFKit founder), ~160k GitHub stars, very active through mid-2026 (Steinberger left to
lead OpenAI's personal-agents division in Feb 2026, but the project continues). It's a
self-hosted **gateway**: a three-layer architecture (channel / brain / body) where messaging
adapters normalize protocols, an agent runtime reasons, and tools take actions. Note it's an
**agent application, not a developer framework** — you configure it, you don't embed it.

**Can it run on a Pi?** Yes, technically — there's an official Raspberry Pi install guide and
most features (Node.js, Telegram, Chromium) work on ARM64. But the resource picture is poor
for this use case:
- Requires Pi 4/5 with **2 GB minimum, 4 GB+ recommended**; 2 GB is "install and test" only.
- The gateway process alone idles at **400–800 MB**; add the Node.js 22/24 runtime, OS, and
  (often) Docker and a 2 GB Pi is already swapping. 4 GB machines "hit swap regularly" with
  multiple skills or large context threads. OOM is a documented, common problem.
- It writes to memory files, logs, and conversation history **constantly** — the docs
  explicitly recommend an NVMe/USB SSD to avoid premature SD-card death. That directly
  conflicts with a low-maintenance appliance on an SD card.

**Telegram / camera / GPIO:** Telegram is a first-class channel (the docs call it the fastest
to set up). But camera and GPIO are **not** built-in — you'd write custom tool plugins for
those anyway, which is most of the work you'd do in a bespoke service.

**Security:** OpenClaw "grants significant system access by design." For an appliance that may
be reachable for remote checking, running a general-purpose agent with shell/tool access and
its own web surface is a materially larger attack surface than a single-purpose service that
only calls the Claude API and toggles relays. The docs' own guidance ("the security
implications scale with what you're doing") is a caution, not a feature.

**Verdict:** OpenClaw is excellent if you want *one assistant that does everything* across
many chat apps. For a **single-purpose plant appliance**, it's the wrong shape — heavier,
more fragile on flash storage, broader attack surface, and you still write the camera/GPIO
glue yourself. A ~300-line Python service calling `claude-opus-4-8`/Haiku is simpler, lighter,
and easier to reason about and secure.

## 2. Mycodo and other OSS grow controllers

**Mycodo** (kizniche/Mycodo, maintained by Kyle Gabriel) is the standout purpose-built option
and is actively maintained. It's a Pi-native environmental monitoring and regulation system
(originally for mushroom cultivation) with exactly the primitives this project needs:
- **Inputs**: sensors, GPIO states, ADCs, I²C/1-Wire — temp, humidity, pH, EC, water level, etc.
- **Outputs**: switch GPIO high/low, **PWM**, pumps, wireless outlets, MQTT publish, run shell
  scripts and Python — i.e. relay control for pumps and lights is native.
- **Functions**: **PID** control loops, Conditionals, Triggers, Timers/schedules coupling
  inputs to outputs.
- **Cameras**: live streaming, still capture, **time-lapse** — useful for the AI vision feed.
- Backend daemon + Flask web frontend with dashboards, graphs, and user auth.

It's more complex than a hand-rolled script (a full web app with a daemon), but it hands you
the tedious, safety-critical parts — relay scheduling, PID, camera capture, a real dashboard —
for free and reliably. Its "execute Python code" output and MQTT support give a clean seam to
bolt an AI layer on: Mycodo captures images and runs the hardware; your Python service pulls a
recent image, asks Claude for a decision, and writes the result back (via MQTT or by toggling
a Mycodo input/output).

**Home Assistant + ESPHome** is the other credible path, especially if you'd rather put
sensors/relays on cheap ESP32 nodes than wire everything to the Pi's GPIO. Real projects
exist: **HAGR** (JakeTheRabbit/HAGR — VPD climate control, crop steering, batch-tank dosing,
PWM-dimmable LEDs) and **esponics** (jjensn/esponics). HA gives you entities, automations,
dashboards, and mobile notifications; ESPHome makes the ESP32 relay/sensor firmware trivial.
Downside: it's a bigger stack to run and the AI integration is less direct than "Python
service ↔ Claude."

**Build vs buy:** For a first DIY build, **Mycodo beats a from-scratch custom controller** for
the hardware/scheduling/camera/PID layer — reimplementing reliable relay timing and PID by
hand is avoidable risk. Keep the **AI decision logic as a separate small Python service** so
the "brain" stays simple and swappable. If you prefer ESP32 nodes over Pi GPIO, HA+ESPHome is
the equivalent choice.

## 3. Telegram bot library (Python, 2026)

Two mature async options:
- **python-telegram-bot (PTB)** — the most widely used, batteries-included, excellent docs,
  fully async (v20+ rebuilt on asyncio). Great for a bot with a handful of commands, sending
  photos, and inline keyboards. Easiest on-ramp.
- **aiogram** — modern, fully async (asyncio + aiohttp), Python 3.10+, current version **3.29.x**
  (May 2026). More powerful routing/FSM, favored for sophisticated bots; `InlineKeyboardBuilder`
  + `message.answer_photo(..., reply_markup=kb)` is clean.

Both send photos with inline keyboards easily and both are fully async. **Recommendation:
python-telegram-bot** for this project — the bot is simple (push a photo + "Water now?" /
"Health report" buttons, receive commands), and PTB's docs and ubiquity make it the
lower-friction choice. Choose aiogram only if you expect complex conversational flows/FSM.

## 4. Claude API for plant vision + decisions

Use the Anthropic Messages API with vision. Current models and pricing (per 1M tokens):

| Model | ID | Input | Output | Notes |
|---|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | Fast/cheap; ideal for routine per-image checks |
| Claude Sonnet 5 | `claude-sonnet-5` | $3.00 ($2 intro to 2026-08-31) | $15.00 ($10 intro) | Escalation / weekly deep review |
| Claude Opus 4.8 | `claude-opus-4-8` | $5.00 | $25.00 | Overkill for this; reserve for hard diagnosis |

**Structured decisions:** use structured outputs (`output_config.format` with a JSON schema)
so each analysis returns a typed object, e.g.
`{water: bool, light_hours: float, health_notes: string, confidence: float}`. Use
`client.messages.parse()` with a Pydantic model to get validated objects directly. (Note: on
current models the old assistant-"prefill" trick for forcing JSON returns a 400 — use
structured outputs instead.)

**Prompt caching:** keep a stable system prompt (plant profiles, rules, schema description)
and cache it (`cache_control: {type: "ephemeral"}`) — cache reads are ~0.1× input price, so the
per-image cost is dominated by the image tokens, not the instructions.

**Cost estimate** (Haiku 4.5, the right default here):
- Per image: ~1,600 image tokens + ~500 prompt/context tokens ≈ **~2,100 input tokens** (system
  prompt cached after the first call), ~300 output tokens.
- Per analysis ≈ 2,100 × $1/1M + 300 × $5/1M ≈ **$0.0021 + $0.0015 ≈ $0.0036**.
- **24 images/day → ~$2.6/month. 48 images/day → ~$5.2/month.** Budget ~$3–7/month including
  occasional retries and the odd Sonnet escalation.
- If you ran everything on **Sonnet 5** instead: ~3× → roughly **$8–16/month**. Not worth it
  for routine hourly checks; use Haiku for the loop and escalate to Sonnet only when Haiku's
  confidence is low or for a weekly deep health review.

Cameras produce 24–48 images/day comfortably within Haiku's 200K context per call (one image
per call). This is a genuinely cheap workload.

## 5. Scheduling & reliability on the Pi

- **systemd service** for the AI/Telegram service: `Restart=always`, `RestartSec`, and a
  `WatchdogSec=` with `sd_notify` heartbeats so systemd restarts a hung process. Run it as a
  non-root user with only GPIO access.
- **Hardware watchdog** for total freezes: `dtparam=watchdog=on` in `/boot/config.txt` + the
  `watchdog` service (`watchdog-timeout ≈ 15`) to auto-reboot a locked Pi.
- **Protect the SD card** — the #1 cause of Pi field failures (cards can die in 6–18 months
  under constant writes):
  - **log2ram** — mount `/var/log` in RAM, flush periodically (`systemctl status log2ram`).
  - **Overlay filesystem / read-only root** — Raspberry Pi Config → Performance → Overlay File
    System (+ read-only boot partition) makes the root FS immutable and power-loss-safe. Put
    the little mutable state you need (config, last-decision cache) on a separate writable
    partition or a USB SSD. Booting from **USB SSD/NVMe** sidesteps SD wear entirely and is the
    most robust option — and is effectively required if you go the OpenClaw route.
  - Move logs/DB off the card; disable swap on flash or point it at SSD.
- **Remote access: Tailscale.** Put the Pi on a tailnet for encrypted, keyed remote SSH/web
  access without opening ports or exposing the appliance to the public internet — the right
  answer given the security concern in §1. (No inbound firewall holes; MagicDNS for easy
  addressing.)
- Keep secrets (Claude API key, Telegram token) in an env file readable only by the service
  user, not in the repo.

---

## Recommended architecture (opinionated)

```
[Sensors + Camera] ─▶ Mycodo (daemon + web UI)
                         │  captures images, runs PID/relays/pumps/lights on schedule
                         ▼
                 image + sensor snapshot
                         │  (MQTT or shared file / Mycodo Python-output hook)
                         ▼
        Custom Python "brain" service (systemd, watchdog)
          ├─ Claude API (Haiku 4.5 default; Sonnet 5 escalation), structured JSON decisions
          ├─ writes decisions back to Mycodo (toggle output / adjust setpoint)
          └─ python-telegram-bot: pushes photos + health notes, inline "Water now / Report" buttons
                         ▲
                         │ Tailscale for remote SSH/dashboard
        SD card protected by log2ram + overlay FS (or boot from USB SSD)
```

Rationale: Mycodo owns the safety-critical, real-time hardware layer (proven relay/PID/camera
code + free dashboard); a small Python service owns the AI reasoning and Telegram UX (simple,
swappable, minimal attack surface); Claude Haiku keeps monthly cost in single digits. Skip
OpenClaw — wrong shape and weight for a single-purpose appliance. If you'd rather use ESP32
nodes than Pi GPIO, substitute Home Assistant + ESPHome for Mycodo and keep the same brain
service.

---

## Sources

OpenClaw:
- https://docs.openclaw.ai/ and https://docs.openclaw.ai/install/raspberry-pi
- https://github.com/openclaw/openclaw
- https://en.wikipedia.org/wiki/OpenClaw
- https://sfailabs.com/guides/openclaw-hardware-requirements
- https://openclaw-setup.me/blog/usage-tips/openclaw-raspberry-pi-memory-oom-fix-guide/

Mycodo / grow controllers:
- https://github.com/kizniche/Mycodo and https://kizniche.github.io/Mycodo/
- https://github.com/JakeTheRabbit/HAGR
- https://github.com/jjensn/esponics
- https://nachbelichtet.com/en/diy-irrigation-control-with-home-assistant-and-esphome

Telegram libraries:
- https://github.com/aiogram/aiogram and https://pypi.org/project/aiogram/
- https://blog.finxter.com/top-10-python-libraries-to-create-your-telegram-bot-easily-github/

Claude API (models, pricing, structured outputs, caching): Anthropic Messages API — model IDs
`claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-4-8`; pricing per platform.claude.com/docs
pricing and models overview (verified against current Anthropic model catalog, 2026-06).

Pi reliability:
- https://www.dzombak.com/blog/2024/04/pi-reliability-reduce-writes-to-your-sd-card/
- https://forums.raspberrypi.com/viewtopic.php?t=237735 (log2ram)
- https://hallard.me/raspberry-pi-read-only/ (read-only overlay)
