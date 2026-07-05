# samogrow (nombox) — Build Spec

**Version:** v1.2
**Date:** 2026-07-05
**Owner:** Nik (nik@postgres.ai)
**Status:** Ready to build

A DIY, AI-controlled indoor hydroponic herb garden — always-fresh herbs and
greens (parsley, basil, cilantro, mint, lettuce) on a countertop or shelf. An
affordable, open, kit-style alternative to
Auk, Click & Grow, and (the real target) Gardyn.

**No microcontroller in the garden.** The brain — a TypeScript/Bun service that
calls the Claude API and runs a Telegram bot — runs on any always-on machine you
already own (laptop, mini-PC, VM). The garden device itself contains only
**Wi-Fi-controlled endpoints**: two smart plugs (light + pump) and a Wi-Fi camera.
There is nothing to solder, no GPIO, no relay board, no 12 V wiring.

---

## 1. Goal & why

**Goal:** grow a continuous supply of herbs and leafy greens — parsley, basil,
cilantro, mint, lettuce — indoors, year-round,
with plant care automated and monitored by AI — for a one-time hardware cost in the
low-to-mid hundreds and **no subscription**.

**Why DIY instead of buying a smart garden:** the commercial market runs on the
razor-and-blades trap (see `research/01-commercial-analogs.md`). Every premium
brand monetizes proprietary pods and/or a mandatory membership:

- Click & Grow: ~$150–250/yr in proprietary pods + subscription.
- Gardyn (the only commercial unit with real camera+AI): **$899 hardware + a
  $29–39/mo Kelby AI membership (~$408/yr)** — 3-year TCO north of $2,500.
- Lettuce Grow: $200–400/yr consumables.

The AI-camera tier is exactly the feature people pay the most for, and only Gardyn
ships it. A Wi-Fi camera + a laptop-side Claude Haiku vision service delivers the
same capability (plant-health checks, watering/lighting decisions, harvest nudges)
for **~$3–7/month in API calls and zero recurring fees**, on **open, commodity
consumables** (bulk seeds, rockwool, generic 2-part nutrient) that cost a few
dollars per grow cycle. Open consumables are our biggest structural advantage, and
they sidestep the vendor-lock-in / brand-stability risk that stranded AeroGarden
owners.

**Why no Raspberry Pi:** removing the on-device controller removes the hardest and
riskiest parts of the build — no soldering, no MOSFET/flyback wiring, no 3.3 V
level-shifting, no SD-card reliability engineering, no separate 12 V supply. The
"garden" becomes three network appliances that any home already knows how to run.
The brain lives on a machine you're already keeping powered on. (If you later want
a hard-wired float switch or a CSI camera, an on-device Pi controller is a clean
upgrade path — see the appendix.)

**Non-goals for v1:** no proprietary pods, no hand-wired mains relays, no local LLM,
no on-device microcontroller, no hard-wired float switch (see §9 for the honest
residual-risk discussion).

---

## 2. User stories

Nik is the user. He wants:

1. **Fresh parsley and greens on tap.** Parsley, basil, cilantro, and lettuce
   growing continuously so there's always something to cut — not a single harvest.
2. **Telegram control and reports.** A daily photo + health note pushed to
   Telegram; inline buttons to water now / get a report; the ability to ask "how do
   the plants look?" from his phone. The bot obeys only his chat ID.
3. **DIY but practical.** He wants to build and understand it, but it should run
   reliably for weeks. With no microcontroller, "reliability" is just keeping one
   always-on machine and three Wi-Fi devices up.
4. **Price-sensitive but quality-minded.** Beat the commercial units on cost and
   openness without cutting corners on what causes real failures: quiet pump, even
   full-spectrum light, no algae, no fire risk.
5. **Safety first on mains.** Both mains loads (light and pump) switch through
   UL-listed smart plugs — Nik is not an electrician and will not hand-wire 120 V.

---

## 3. Architecture

![samogrow system schematic — an always-on machine runs the Bun brain, talks to the Claude API and Telegram over the internet, and over home Wi-Fi commands two Kasa smart plugs (light and top-up pump), a jug pump feeding the DWC tote, an always-on air pump, and a Tapo RTSP camera watching the plants](../docs/img/schematic.svg)

Growing method (per `research/02-hydroponics-parts.md`): **Deep Water Culture
(DWC)** in a shared opaque tote — roots sit in aerated nutrient solution, an air
pump + air stone oxygenate 24/7, and a plain-water top-up jug keeps the level up
via a small pump that the software runs on a timer. DWC beats Kratky here because
continuous-harvest herbs (parsley, basil, mint) need oxygen at the roots the whole
time, and because automated top-up is native to DWC. One reservoir, ~6 net cups,
one nutrient batch — the simplest thing for the AI to monitor.

Everything the software touches is a **network appliance on the home Wi-Fi**:

- **Grow light** → Kasa smart plug (UL-listed, controlled over the local LAN with
  the Kasa protocol; e.g. KP125/EP10).
- **Top-up pump** → a **second Kasa smart plug** switching a cheap 120 V submersible
  fountain pump (or a 12 V pump with its wall-wart plugged into the plug). Watering
  = "turn the pump plug on for N seconds." Software timer caps are the flood
  protection (see §9). An energy-monitoring plug (KP125/EP25) doubles as a
  pump-health signal — wattage confirms the pump is actually running.
- **Camera** → a Wi-Fi camera exposing local **RTSP snapshots** (e.g. TP-Link Tapo
  C110/C120). The brain pulls a still frame over RTSP; no cloud camera account is
  used for the vision loop.

```
   ALWAYS-ON MACHINE (laptop / mini-PC / VM)
   ┌───────────────────────────────────────────────┐
   │  samogrow brain — TypeScript/Bun service       │
   │   • pulls RTSP snapshot from the camera         │
   │   • POSTs photo to Claude API -> JSON verdict   │
   │   • toggles light + pump smart plugs (Kasa LAN) │
   │   • grammY Telegram bot (obeys Nik's chat id)   │
   └───────┬───────────────────────────┬─────────────┘
           │ home Wi-Fi / LAN          │ internet
           │                           │
   ┌───────┴───────────────┐   ┌───────┴───────────────┐
   │  GARDEN DEVICE        │   │  CLOUD                │
   │                       │   │   • Claude API (Haiku │
   │  [Kasa plug: LIGHT]   │   │     vision, JSON)     │
   │        │              │   │   • Telegram API      │
   │  [LED grow light]     │   └───────────────────────┘
   │   ~~ over canopy ~~   │
   │                       │
   │  [Kasa plug: PUMP]    │
   │        │              │
   │  [120V top-up pump] <── plain water from [top-up jug]
   │        │  pumps into  │
   │        v              │
   │  ┌──────────────────┐ │
   │  │ opaque DWC tote  │ │
   │  │  net cups x6     │ │      [Wi-Fi camera / RTSP]
   │  │  parsley/basil/  │ │        framing the canopy
   │  │  cilantro/lettuce│ │            │
   │  │  nutrient soln   │ │◄───────────┘ (snapshot pulled by brain)
   │  │  [air stone] <── [air pump 24/7, always powered]
   │  └──────────────────┘ │
   └───────────────────────┘
```

Data flow: on a timer during light hours, the brain pulls an RTSP snapshot, POSTs
it to Claude, gets a structured JSON verdict, applies watering/lighting decisions
within hard timer caps by toggling the two plugs, and pushes results to Telegram.

### 3a. Alternative software paths (documented, not chosen)

The locked decision is a **custom TypeScript/Bun service** (Nik's mandate). From
`research/04-software-stack.md`:

- **Mycodo / Home Assistant + ESPHome:** purpose-built grow controllers that hand
  you relay/PID/camera/scheduling for free — but they assume on-device I/O and a
  bigger stack than a three-appliance, laptop-brain design needs, and Mycodo is
  Python. Overkill here.
- **OpenClaw as the brain: rejected outright.** A general-purpose personal-agent
  gateway (400–800 MB idle, constant flash writes, broad system access) — wrong
  shape and weight, and a large attack surface. The custom Bun service keeps the
  attack surface to "call Claude + toggle two plugs + pull one RTSP frame."

---

## 4. Bill of materials

Prices are USD, mid-2026. Items marked **(est.)** are market-typical estimates from
the research files (Amazon renders prices in JavaScript, so live figures weren't
machine-readable); expect ±30% from coupons/sellers. Sources:
`research/02-hydroponics-parts.md` (grow side) and `research/03-electronics.md`
(smart plugs, camera). Direct purchase links: see `spec/SHOPPING-LIST.md`.

Two tiers: **Core build** is a complete working AI garden. **Nice to have** is the
second-tier upgrades the software anticipates.

**The centerpiece is that the electronics side is now trivial** — two smart plugs,
a Wi-Fi camera, and a pump — landing under ~$70, with the bulk of the cost in the
grow side (which you'd pay on any hydroponic system) and the light.

### 4a. Core build — network appliances / "electronics"

| Part | Suggested product | Est. price | Source |
|---|---|---:|---|
| Light + pump switching | Kasa smart plugs, 2-pack (KP125 / EP10 class) | **$25** | kasasmart.com; UL-listed, local LAN control |
| Camera | TP-Link Tapo C110 / C120 (Wi-Fi, RTSP) | **$25** (est.) | supports local RTSP snapshots |
| Top-up pump | Small 120 V submersible fountain pump | **$12** (est.) | switched by the pump plug |
| Pump tubing | Vinyl tubing for the top-up feed | **$6** (est.) | jug → reservoir |
| | **Appliance subtotal** | **~$68** | |

No microcontroller, no PSU beyond the pump's own plug, no MOSFET, no float switch,
no breadboard, no enclosure, no jumper wire. Nothing to solder.

### 4b. Core build — grow side

| Part | Suggested product | Est. price | Source |
|---|---|---:|---|
| Reservoir | Opaque food-safe tote, ~5–7 gal | **$12** (est.) | must be opaque (algae); drill 3" holes |
| Net cups | 3" net pots, 25-pack | **$13** (est.) | Amazon |
| Starter plugs | Grodan A-OK 1.5" rockwool, 50 ct | **$12** (est.) | Amazon |
| Grow media | Hydroton / LECA clay pebbles, ~10 L | **$20** (est.) | reusable, rinse first |
| Air pump | Adjustable aquarium air pump, dual outlet | **$15** (est.) | runs 24/7, low power, always on |
| Air stone | Air stone / disc diffuser, 2-pack | **$8** (est.) | Amazon |
| Airline | Silicone airline 25 ft + check valve | **$7** (est.) | check valve stops back-siphon |
| Top-up jug | 1–2 gal jug for plain-water feed | **$6** (est.) | bounds the worst-case flood (see §9) |
| Nutrient | MasterBlend 4-18-38 Combo Kit, 2.5 lb | **$28** (est.) | makes ~180 gal — outlasts the build |
| pH | GH pH Control Kit (Up/Down + indicator) | **$22** (est.) | target pH 5.5–6.5 |
| Grow light | Barrina T5 2 ft full-spectrum strips, 4-pack | **$40** (est.) | ~20 W/strip, linkable, adjustable height |
| Seeds | Parsley + basil + cilantro + lettuce packets | **$15** (est.) | Sow Right / Botanical Interests |
| | **Grow-side subtotal** | **~$198** | |

### 4c. Core build grand total

| Section | Est. cost |
|---|---:|
| Network appliances (light plug, pump plug, camera, pump) | ~$68 |
| Grow side | ~$198 |
| **Core build total** | **~$266** |

The air pump is powered continuously (its own wall plug or a third always-on
outlet) — DWC needs oxygen 24/7, so it is deliberately **not** on a switched plug.

### 4d. Nice to have (upgrades)

| Add-on | Product | Est. price |
|---|---|---:|
| Second camera angle | 2nd Tapo Wi-Fi camera (RTSP) | **$25** (est.) |
| Nutrient dosing | Kasa plug + small dosing pump (timed) | **$25** (est.) |
| Air-pump monitoring | Third energy-monitoring plug (air-pump health) | **$13** (est.) |
| pH precision | Digital pH pen | **$15** (est.) |
| | **Nice-to-have delta** | **~$78** |

### 4e. Yearly consumables

Almost everything is a one-time kit that lasts many grows:

| Consumable | Notes | Est. $/yr |
|---|---|---:|
| Nutrient (MasterBlend) | 2.5 lb kit makes ~180 gal — years of supply | ~$0 (amortized) |
| Rockwool plugs | ~$12/50 ct; 1–2 refills/yr | ~$15 |
| Seeds | new packets / varieties | ~$15 |
| pH Up/Down refills | occasional | ~$8 |
| **Total ongoing** | | **~$35/yr** |

### 4f. Cost comparison over 2 years

| System | Hardware | 2-yr subscription/consumables | AI? | 2-yr total |
|---|---:|---:|:--:|---:|
| **samogrow (no-Pi core)** | ~$266 | ~$70 consumables + ~$120 Claude API ($5/mo) | **Yes** | **~$456** |
| Gardyn Home 4 | ~$899 | ~$816 (Kelby AI $34/mo) | Yes | **~$1,715** |
| Click & Grow SG9 | ~$200 | ~$400 (pods + sub) | No | **~$600** |
| Auk Mini 2 | ~$229 | ~$0 (bring your own seeds) | No (scheduling only) | **~$229** |

**The pop:** samogrow lands in the same one-time price bracket as the *no-AI*
countertop units (~$200–266) while delivering the camera+AI capability that
otherwise **only exists on the $899 Gardyn with a ~$408/yr subscription.** Over two
years it comes in around **$456 all-in — roughly $1,260 cheaper than Gardyn** and
below even a Click & Grow SG9's 2-year cost, while adding AI monitoring, more
plants, and open consumables with no lock-in. The DIY "premium" over the cheapest
timer units is small; the AI-tier savings are enormous.

---

## 5. Assembly plan

![Field-guide illustration of the samogrow parts laid out — two full-spectrum T5 light strips above a DWC tote of basil, parsley, cilantro and lettuce in net cups, a top-up water jug with a small pump, a Wi-Fi camera, an air pump feeding an air stone, and two smart plugs on a power strip](../docs/img/build-illustration.jpg)

No soldering, no wiring. Assembly is plumbing + plugging in + network config.

### Day 0 — order everything

Place the full core-build order (see `spec/SHOPPING-LIST.md`). The two Kasa plugs,
the Tapo camera, and the pump are all standard consumer Wi-Fi gear.

### Day 1–2 — start germination IMMEDIATELY

**Parsley is the bottleneck: germination takes 10–28 days.** Start seeds the moment
they arrive, before building anything.

1. **Soak parsley seeds** in warm water 12–24 h (change the water once) to leach out
   the coumarin germination inhibitors.
2. Rinse/pH-condition rockwool plugs. Sow soaked parsley + basil + cilantro +
   lettuce into separate plugs.
3. Keep plugs **~70 °F (21 °C) and constantly moist** — one dry-out kills
   germinating parsley. Basil sprouts in 5–7 days; parsley in 10–28.
4. Use flat-leaf "Giant of Italy" parsley, Genovese basil, a slow-bolt cilantro
   (Calypso/Santo), and a loose-leaf lettuce. For mint, use a rooted cutting in its
   own cup at one end.

### Day 2–4 — build the DWC reservoir

1. Drill six 3" holes in the opaque tote lid for net cups.
2. Rinse the LECA pebbles (dusty) and the rockwool.
3. Run airline from the (always-on) air pump → check valve → air stone in the
   bottom of the tote. Keep the air pump above the water line.
4. Position the top-up jug **above** the reservoir; put the small pump in the jug
   and run its tubing into the tote.
5. Mix nutrient per MasterBlend directions (all three parts, never combine
   concentrates undiluted) to a mild solution (EC ~1.0–1.6 / ~700–1100 ppm). Adjust
   pH to 5.5–6.5 with the GH kit.

### Day 4–5 — light + camera + plugs

1. Mount the Barrina strips 15–30 cm above the canopy, spaced for even coverage,
   at **adjustable** height (avoid Click & Grow's fixed-height flaw). Plug the light
   into **Kasa plug #1**.
2. Plug the top-up pump into **Kasa plug #2**. Plug the air pump into a normal,
   always-on outlet (never a switched plug — DWC needs oxygen 24/7).
3. Mount the Tapo camera to frame all six cups from short range.
4. Onboard all three Wi-Fi devices in their apps (Kasa app for the plugs, Tapo app
   for the camera). In the Tapo app, **create an RTSP camera account** (username +
   password) and note the RTSP URL. Set **DHCP reservations** on your router so the
   plugs and camera keep stable IPs.

### Day 5 — software on the always-on machine (Mac / mini-PC / VM)

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`.
2. Clone the repo, `cd software`, `bun install`.
3. Create `.env` with `SAMOGROW_TELEGRAM_TOKEN`, `SAMOGROW_TELEGRAM_CHAT_ID`,
   `ANTHROPIC_API_KEY` (readable only by you). Get the bot token from **BotFather**;
   get your chat id from the bot's first message.
4. Create `config.json` with the two plug hosts (`light.plugHost`,
   `pump.plugHost`), the camera RTSP URL(s), pump calibration, and light schedule.
5. Run in **mock mode** first (`SAMOGROW_MOCK=1 bun run src/main.ts`) to validate
   the Claude call + Telegram push with no devices. Then run live.
6. Install as a background service: **launchd** on macOS (a `LaunchAgent` plist with
   `KeepAlive`) or **systemd** on a Linux VM (`Restart=always`). Keep the machine
   awake (disable sleep, or use `caffeinate` on Mac).
7. Transplant sprouted plugs into net cups (surround with LECA) once they have roots
   and true leaves.

---

## 6. Device setup & network (replaces "wiring")

There is no wiring diagram because there is no wiring. The whole "electronics"
integration is network config:

| Device | Onboard in | Software needs | Stability |
|---|---|---|---|
| Light smart plug | Kasa app | `light.plugHost` (IP) | DHCP reservation |
| Pump smart plug | Kasa app | `pump.plugHost` (IP) | DHCP reservation |
| Wi-Fi camera | Tapo app | RTSP URL + camera account (user/pass) | DHCP reservation |
| Air pump | — (dumb outlet) | none — always on | always powered |

Notes:

- **Kasa control is local-LAN**, not cloud — the brain discovers/commands the plugs
  on your network. Set both plugs to **static/reserved IPs** so `config.json`
  doesn't drift.
- **RTSP requires a camera account.** In the Tapo app, create a local
  username/password for the camera; the RTSP URL is typically
  `rtsp://<user>:<pass>@<camera-ip>:554/stream1` (confirm the stream path in the
  app). The brain pulls a single snapshot per analysis; it does not stream video to
  the cloud.
- **All mains switching is inside UL-listed smart plugs.** You never touch 120 V.

---

## 7. Implementation details

The service is a small TypeScript/Bun app (`software/`) using `@anthropic-ai/sdk`
for Claude vision and `grammy` for Telegram. Secrets come from env; settings from
`config.json`.

### The control loop

During light hours (`light.onHour`..`light.offHour`, default 07:00–23:00, a 16 h
photoperiod for leafy herbs), every `brain.analysisIntervalMinutes` (default 120):

1. **Capture** — pull a still frame from the camera's RTSP URL.
2. **Analyze** — POST the image to Claude Haiku (`brain.model`, default
   `claude-haiku-4-5-20251001`) with a stable, cached system prompt (plant profiles
   + rules + schema) and get a **structured JSON verdict**, e.g.
   `{ water: bool, light_hours: number, health_notes: string, confidence: number }`.
   Use the SDK's structured-output support (`output_config.format` with a JSON
   schema); keep the system prompt cached (`cache_control`) so per-image cost is
   dominated by the ~1,600 image tokens, not the instructions.
3. **Decide + act, within hard timer caps:**
   - *Watering:* if the verdict says water, turn the **pump plug** on for a bounded
     duration — never longer than `pump.maxSecondsPerRun` per run and never more
     than `pump.maxSecondsPerDay` total per day. `pump.mlPerSecond` converts
     seconds→volume. **These caps are the anti-flood backstop: the AI can request
     water, it cannot override the cap.** If the plug reports energy, read wattage
     to confirm the pump actually drew power (pump-health signal).
   - *Lighting:* toggle the **light plug** to match the configured photoperiod. If
     model confidence is low, prefer the schedule over the model.
4. **Report** — push the photo + `health_notes` to Telegram with inline buttons
   ("Water now", "Report"). A daily digest goes out at `brain.dailyReportHour`
   (09:00). The bot only obeys `telegramChatId`.

### Config knobs (post-pivot shape)

The config moves from GPIO/CSI fields to network fields. Expected shape (the
build-software agent is applying this to `software/src/config.ts`):

| Knob | Example / default | Purpose |
|---|---|---|
| `light.plugHost` | `192.168.1.50` | Kasa plug IP for the grow light |
| `light.onHour` / `offHour` | 7 / 23 | 16 h photoperiod |
| `pump.plugHost` | `192.168.1.51` | Kasa plug IP for the top-up pump |
| `pump.maxSecondsPerRun` | 30 | per-run flood cap |
| `pump.maxSecondsPerDay` | 180 | daily flood cap (hard) |
| `pump.mlPerSecond` | 15 | calibrate before trusting volume |
| `cameras.devices` | `["rtsp://user:pass@host:554/stream1"]` | camera source URLs (RTSP, or `http(s)://…/snapshot.jpg`) |
| `brain.model` | `claude-haiku-4-5-20251001` | Haiku for the routine loop |
| `brain.analysisIntervalMinutes` | 120 | photo + AI cadence |
| `brain.dailyReportHour` | 9 | daily Telegram digest |
| `mockHardware` | false | dev mode — no plugs/camera needed |

### Cost model

Per analysis ≈ 2,100 input tokens (image + cached prompt) + ~300 output ≈
**~$0.0036** on Haiku. At 24 images/day → **~$2.6/mo**; 48/day → **~$5.2/mo**.
Budget **~$3–7/mo** including retries. Escalate to Sonnet only for a weekly deep
review or when Haiku's confidence is low.

---

## 8. Tests plan

### Software (already in repo)

- `bun test` — unit tests.
- `bunx tsc --noEmit` — typecheck.
- **Mock mode first:** `SAMOGROW_MOCK=1 bun run src/main.ts` (`bun run dev`) runs
  the full loop with no plugs/camera — validate the Claude call, JSON parsing,
  decision logic, and Telegram push on your machine before touching devices.

### Device bring-up checklist (do in order)

1. **Plug discovery:** command each Kasa plug on/off from the brain machine; confirm
   the light and pump respond within ~1–2 s and that `config.json` has the right IPs.
2. **RTSP snapshot:** pull a still from the camera URL; confirm the whole tray is
   framed and in focus under the grow light.
3. **Pump calibration:** run the pump plug for a measured 10 s into a measuring cup;
   divide ml by seconds to set `pump.mlPerSecond`. Confirm tubing primes and the jug
   feeds cleanly.
4. **Timer caps:** force repeated "water" verdicts and confirm the pump refuses past
   `maxSecondsPerDay` — this is the flood backstop, test it deliberately.
5. **Energy signal (if the plug supports it):** verify wattage reads > 0 while the
   pump runs and ~0 when idle — this is the pump-health check.
6. **Light schedule dry-run:** confirm the light plug follows the photoperiod.
7. **Restart test:** kill the service; confirm launchd/systemd restarts it and it
   reconnects to the plugs and camera.

---

## 9. Residual risk: no hard-wired float switch (be honest)

The no-Pi build trades a hardware float switch for **software timer caps** as flood
protection. That is a real, deliberate simplification — here is the honest picture:

- **The risk:** the pump is a dumb load on a timed plug. If the software or its
  clock misbehaves and over-runs the pump, there is no hardware interlock to stop it.
- **Mitigation 1 — bounded source.** The top-up **jug holds only 1–2 gal of plain
  water.** The worst case is limited to the jug's volume, not a plumbed line — the
  reservoir tote has headroom for it, so a full-jug dump overfills rather than
  floods the room. Size the jug to less than the tote's remaining headroom.
- **Mitigation 2 — hard timer caps.** `pump.maxSecondsPerRun` and
  `pump.maxSecondsPerDay` cap total pump-on time per day regardless of what the AI
  requests; the caps are tested deliberately (§8 step 4).
- **Mitigation 3 — energy-monitoring plug as a health signal.** A KP125/EP25-class
  plug reports wattage; the brain can detect a pump that's running dry (low draw) or
  stuck on, and alert over Telegram.
- **Mitigation 4 — DWC is forgiving.** The reservoir is *supposed* to stay full;
  slow top-up of a large, aerated body of water is low-stakes compared to a
  drip/NFT system that dries out in minutes.
- **The upgrade** if you want a true interlock: add the on-device Pi controller with
  a hard-wired float switch (appendix) — the one thing the all-Wi-Fi build can't do.

### 9a. Water safety & failure detection (layered)

A fair critique of an all-Wi-Fi build: **the camera alone can't make good water
decisions.** It cannot see the level inside an opaque tote, it cannot tell a running
pump from a dead one, and it will not notice a slow siphon leak onto the floor until
plants wilt hours later. The answer is not one clever sensor but a few cheap,
independent layers — each catches a different failure, and we are honest about what
each one misses. Layers 1–3 are the new **Water safety (recommended)** shopping tier
(~$55–60, see `spec/SHOPPING-LIST.md`); layers 4–5 are already in the design.

**Layer 1 — Camera-readable sight gauge (~$8, passive, no electronics).**
A short length of clear vinyl tube (3/8" ID) is tee'd into the tote wall low down
through a bulkhead/grommet fitting, so the tube shows the true reservoir level by
communicating vessels. Drop a brightly colored float bead in the tube and route the
tube up **inside the camera's field of view**. Now every photo the brain already
takes carries the water level with it — the vision prompt reads the bead's height
against a taped scale and reports reservoir level as a first-class field, no extra
poll.
- *Catches:* the big blind spot — actual reservoir level in an opaque tote, low-water
  (failed top-up / empty jug) and over-full alike, on the existing photo cadence.
- *Misses:* it is only sampled as often as the camera runs (every ~2 h), it depends
  on the tube staying unclogged and in frame, and a floor leak downstream of the tote
  doesn't move the gauge. Not a substitute for layers 2–3.

**Layer 2 — Wi-Fi leak sensor under the tote (~$35, phone push).**
A battery Wi-Fi water sensor (e.g. Govee) sits on the floor directly under the tote
and pump. Its probe closes on the first film of water and pushes a phone alert (and a
loud local alarm) within seconds — independent of the brain, the camera, and even the
samogrow service being up.
- *Catches:* real escaped water — a cracked tote, a popped tubing joint, a siphon
  onto the floor, an overflow that clears the rim. The fastest, most direct "water is
  where it shouldn't be" signal.
- *Misses:* it only fires **after** water reaches the floor (it is a last line, not
  prevention), it needs its own Wi-Fi/battery kept alive, and it says nothing about
  reservoir level or pump health.

**Layer 3 — Passive boot/drip tray under the whole tote (~$12, no electronics).**
A shallow boot tray under the tote and jug physically contains the first liters of any
spill or condensation and channels it to one place — which is also exactly where the
layer-2 sensor sits, so the two compound.
- *Catches:* small drips, condensation, and the leading edge of a spill — buys time
  and protects the surface with zero dependence on power, network, or software.
- *Misses:* finite capacity (a full-jug dump can exceed a shallow tray), and being
  passive it never *notifies* anyone — it only holds water for layer 2 to detect.

**Layer 4 — Pump-health via the KP125M energy-monitoring plug ($0, already in BOM).**
The pump plug is an energy-monitoring KP125M, so every top-up run is also a
measurement. The brain samples power draw during the run and compares it to the
pump's known-good wattage:
- **~zero draw** while the plug is on ⇒ dead pump, unplugged pump, or a dry jug the
  pump can't prime ⇒ the requested water never moved. Alert.
- **anomalous draw** (stalled/clogged impeller, seized motor) ⇒ Alert.
- On any anomaly the brain **locks the pump out** and refuses further runs until Nik
  acknowledges in Telegram — so a misbehaving pump can't be re-triggered every cycle.
This is a software feature being implemented against the existing plug; it confirms
the *actuator* worked, which the camera and the leak sensor cannot.
- *Catches:* the silent "top-up did nothing" failure and the "pump is straining"
  failure — closing the loop between "brain asked for water" and "water actually
  moved."
- *Misses:* it proves the pump drew power, not that water reached the tote (a blown-off
  tube still draws normal watts) — which is why layer 1 (did the level actually rise?)
  and layers 2–3 (did it end up on the floor?) still matter.

**Layer 5 — Hard caps + bounded jug (already in design, see above).**
The per-run and per-day timer caps (`pump.maxSecondsPerRun` /
`pump.maxSecondsPerDay`) and the 1–2 gal top-up jug bound the **worst case** no matter
what any sensor does: the AI cannot pump longer than the cap, and it cannot move more
water than the jug holds. Max credible spill = jug volume, into a tote sized with the
headroom to hold it.

**Net:** level (1), escaped-water alarm (2), passive containment (3), actuator
confirmation (4), and a bounded worst case (5) each cover a failure the others don't.
None is a hard interlock — that remains the Pi + float-switch upgrade (§12) — but
together they turn "camera-only, and blind to the reservoir" into a defensible
multi-layer water story for a no-microcontroller build.

---

## 10. Team of veteran experts

- **The hydroponics grower:** *"Continuous-harvest herbs die of root suffocation,
  not thirst — don't Kratky this, and keep the air pump on a dumb outlet so it can
  never be switched off."* → DWC with a 24/7 air stone on an always-on outlet; only
  the light and top-up pump are on switched plugs. *"And the tote had better be
  opaque."* → hard requirement.
- **The electronics safety engineer:** *"With no Pi and no relays, the only thing
  left to get wrong is the mains switching — so both loads must be UL-listed smart
  plugs, never a bare relay."* → Exactly the design; nothing is hand-wired.
  *"Then your only remaining failure mode is over-watering."* → Addressed head-on in
  §9 (bounded jug + timer caps + energy signal). *"And a camera can't see the water
  level in an opaque tote, can't tell a dead pump from a live one, and won't catch a
  siphon leak on the floor."* → **Now addressed in §9a** with a layered water-safety
  story: a camera-readable sight gauge (level), a Wi-Fi leak sensor + boot tray
  (escaped water), and KP125M energy-monitoring with pump lockout (actuator health) —
  on top of the existing hard caps and bounded jug.
- **The SRE:** *"Your reliability story is now one always-on machine and three Wi-Fi
  devices. Reserve their IPs, keep the machine awake, restart the service on crash,
  and don't put secrets in the repo."* → DHCP reservations, launchd/systemd
  `KeepAlive`/`Restart=always`, secrets in an env file, bot restricted to one chat
  id. *"And if the LAN blips, fail safe."* → the loop no-ops on a missing device and
  reports it rather than thrashing the plugs.

---

## 11. Sprint plan

**Week 1 — order, germinate, software in mock mode.**
Place the Day-0 order. The moment seeds arrive, start germination (parsley first —
it's slow). In parallel, on your always-on machine: `bun install`, get the bot from
BotFather, run the loop in `SAMOGROW_MOCK=1`, and verify the Claude vision call +
JSON verdict + Telegram push work end-to-end against a sample plant photo.

**Week 2 — assemble and deploy.**
Build the DWC reservoir, mount the light and camera, onboard the two plugs and the
camera, set DHCP reservations and the RTSP account. Wire `config.json` to the plug
IPs and RTSP URL. Run the §8 device bring-up checklist. Install the service under
launchd/systemd. Transplant sprouted plugs.

**Week 3+ — tune with real plants.**
Calibrate `mlPerSecond`, tune the photoperiod and analysis cadence, refine the
system prompt against real growth, and decide which nice-to-have upgrades (second
camera, dosing pump, energy monitoring) are worth adding.

---

## 12. Appendix — Alternative: on-device controller (Raspberry Pi)

The all-Wi-Fi build is the recommended v1. Add an on-device controller only if you
want capabilities the network appliances can't provide:

| You want… | Add | Notes |
|---|---|---|
| A **hard-wired float switch** (true flood interlock) | Pi 5 (4GB, ~$75) or Pi Zero 2 W (~$15) + float switch (~$6) | GPIO reads the switch; software gates the pump on it in hardware, not just timers |
| A **better camera** (12 MP autofocus CSI) | Pi + Camera Module 3 Wide (~$35) | Sharper leaves than a Wi-Fi cam; short CSI ribbon |
| **No dependence on a separate always-on machine** | Pi runs the brain on-device | Adds SD-card reliability work (log2ram/overlay FS), a MOSFET + 12 V supply for a low-voltage pump, and 3.3 V GPIO wiring |

Trade-off: the Pi path reintroduces real low-voltage wiring, SD reliability
engineering, and a device to maintain — the exact complexity the no-Pi build
removes. Take it only for the float-switch interlock or the CSI camera.

---

## 13. Changelog

- **v1.2 (2026-07-05)** — Added §9a **Water safety & failure detection (layered)**,
  answering the "camera can't see reservoir level / pump health / floor leaks"
  critique: a camera-readable clear-tube sight gauge with a float bead (level, ~$8),
  a Wi-Fi leak sensor (escaped-water push alert, ~$35) and a boot/drip tray (passive
  containment, ~$12), plus a documented pump-health feature using the existing KP125M
  energy-monitoring plug (zero/anomalous draw ⇒ alert + pump lockout until
  acknowledged in Telegram), layered over the existing hard caps + bounded jug. Added
  a matching **Water safety (recommended)** tier to `SHOPPING-LIST.md` (~$55–60,
  itemized separately from the core total). Updated the electronics-safety-engineer
  panel note to mark the critique addressed.
- **v1.1 (2026-07-04)** — Architecture pivot: **removed the Raspberry Pi.** Brain
  now runs on any always-on machine (laptop/mini-PC/VM). Garden device is
  Wi-Fi-only: two Kasa smart plugs (light + timed pump) and a Tapo RTSP camera.
  Electronics side drops to ~$68; core-build total ~$266. Added §9 residual-risk
  discussion (no hard-wired float switch) with bounded-jug + timer-cap + energy-
  signal mitigations. Config shape moves to `plugHost` / `rtspUrls`. Pi build moved
  to an appendix. Software install targets Mac/VM (launchd/systemd).
- **v1.0 (2026-07-04)** — Initial build spec (Raspberry Pi 5 on-device controller,
  GPIO pump via MOSFET, hard-wired float switch, CSI camera). Superseded by v1.1.
