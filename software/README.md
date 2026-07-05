# samogrow software

The brain for the samogrow DIY AI herb garden: a camera + Claude vision loop that
watches the plants, switches the grow light and water pump, and reports to (and
takes commands from) a Telegram bot.

Runtime: [Bun](https://bun.sh) + TypeScript (strict).

## Topology

There is **no computer inside the garden**. This service runs on any always-on
machine on the same LAN — a laptop, a small VM, a NAS — and controls the garden
entirely over Wi-Fi:

- **Grow light** → a Kasa smart plug (local protocol, no cloud).
- **Pump** → a *second* Kasa smart plug switching a cheap submersible pump.
  "Watering" is just: plug on for N seconds, then off.
- **Camera(s)** → Wi-Fi camera(s) exposing an RTSP stream (snapshotted with
  `ffmpeg`) or a plain HTTP snapshot URL.

Because watering is only a timed plug switch, the pump safety caps are the sole
flood/dry-run protection — see below.

## Architecture

| Module | Responsibility |
| --- | --- |
| `config.ts` | Settings from `config.json`, secrets from env vars |
| `hardware.ts` | Light + pump smart-plug switches (Kasa 9999 + KLAP transports, auto-detected); pump safety caps; energy-meter reads + lockout |
| `camera.ts` | One timestamped JPEG per camera (RTSP via ffmpeg, or HTTP snapshot) |
| `state.ts` | `bun:sqlite` store of events + analyses + growth journal; trend queries |
| `brain.ts` | Claude vision analysis → strict, clamped JSON verdict (per-pot); weekly deep review |
| `trends.ts` | Pure sparkline + daily-aggregation + week-over-week helpers |
| `overrides.ts` | Remote-tuning whitelist + `overrides.json` merge (pump caps lower-only) |
| `conversation.ts` | Conversational Telegram: Claude tool-use loop over the controller API |
| `timelapse.ts` | Build an MP4 timelapse of camera 0 from archived JPEGs (ffmpeg) |
| `controller.ts` | The minute loop: light schedule, periodic analysis, daily report, weekly deep review, bot API |
| `bot.ts` | grammY Telegram bot (owner-only): commands + free-form chat |
| `main.ts` | Wires it together; graceful shutdown |

### Pump safety (the only flood protection)

Enforced in code, never by the model:

- Every run is clamped to `maxSecondsPerRun` and a per-day `maxSecondsPerDay`
  budget (reset at midnight).
- The plug is always switched **off in a `finally`**, and OFF is **re-sent**
  (belt-and-suspenders) after every run.
- The pump plug is forced **OFF on service startup and shutdown**, so a crash
  mid-watering can't leave it running.
- The brain's `waterTopUpMl` is validated and capped at 500 ml before it can act.

Start with conservative caps and calibrate `mlPerSecond` (below).

### Pump-health monitoring & lockout

If the pump plug is a **KP125M** (energy-metering), every timed run samples the plug's
power draw (`{"emeter":{"get_realtime":{}}}`) ~2 seconds after turn-on. A draw below
`pump.minWatts` (default 2 W) means the pump is dead, unplugged, or running dry (empty
reservoir): the pump is marked **unhealthy**, an alert is pushed to Telegram, and further
**automatic** runs are **locked out** until you acknowledge — tap **[Pump fixed — re-enable]**
or send `/pump enable`. A manual `/water` while locked requires an explicit override
confirmation (a distinct button). Each run's wattage is logged for the power sparkline.

Like the caps, the lockout lives in the hardware layer, so **no caller** (bot, brain,
conversation tool, `/set`) can bypass it without the explicit override. The lockout state
is persisted (`bun:sqlite`) and restored on restart. The brain verdict also carries a
camera-read `reservoirLevel` (`ok` / `low` / `unknown`) from a sight-tube float bead if
visible; `low` raises an alert.

## Requirements

- Bun (`curl -fsSL https://bun.sh/install | bash`)
- `ffmpeg` on `PATH` (only needed for RTSP cameras; not needed in mock mode)

## Run on a Mac (mock mode)

```sh
cd software
bun install
SAMOGROW_MOCK=1 bun run src/main.ts   # no hardware, log-only plugs, placeholder photos
```

With no Telegram token set it runs headless (controller only) and logs its
light-schedule decision. Quality gates:

```sh
bun install
bunx tsc --noEmit
bun test
```

## Run for real (Mac or Linux VM)

1. `cd software && bun install` (and install `ffmpeg`).
2. Copy `.env.example` to `.env` and fill in secrets. **Bun auto-loads `.env`**
   from the working directory, so no extra loader is needed.
3. Copy `config.example.json` to `config.json` and set your plug IPs, camera
   URLs, schedule, and pump caps.
4. `bun run src/main.ts` (or install a service — see `deploy/`).

- **Linux/systemd:** `./deploy/install.sh` installs Bun, ffmpeg, and the
  `deploy/samogrow.service` unit (edit its `User`/paths first).
- **macOS/launchd:** edit and load `deploy/com.samogrow.plist`.

### Smart plugs

Two local (no-cloud) transports are supported, selected per plug via `plugType`:

- **`kasa`** — the legacy TP-Link local protocol (TCP 9999, XOR cipher). Older
  Kasa-class plugs: **KP115 / EP10 / HS103**.
- **`klap`** — the encrypted KLAP handshake newer Kasa firmware requires
  (**KP125M** and other 2023+ devices, which no longer answer on port 9999).
  HTTP on port 80, AES-128-CBC. Needs your TP-Link cloud credentials (below).
- **omit `plugType`** — **auto-detect**: probe legacy 9999 with a short timeout,
  fall back to KLAP, and remember which worked for the rest of the run. This is
  the friendliest default and works for both plug generations.

Set `light.plugHost` / `pump.plugHost` to each plug's LAN IP, and give the plugs
**static IPs or DHCP reservations** so the addresses don't change.

**KLAP credentials.** KLAP plugs authenticate locally against the TP-Link cloud
account the plug was provisioned with — set them in env (never in `config.json`):

```
SAMOGROW_TPLINK_EMAIL=you@example.com      # your case-sensitive Kasa app email
SAMOGROW_TPLINK_PASSWORD=your-kasa-password
```

The handshake stays on the LAN (no cloud round-trip); the credentials just derive
the session keys. Legacy `kasa` plugs ignore these.

**Troubleshooting.** If a plug doesn't respond on either protocol, check that the
`plugHost` IP is correct and that the plug is on the **same LAN/VLAN** as this
service (KLAP and Kasa are local-only — a plug on a separate IoT VLAN is
unreachable). For KLAP specifically, an auth failure almost always means the
email/password don't match the account that set the plug up.

### Cameras

Each entry in `cameras.devices` is a URL:

- RTSP: `rtsp://user:pass@192.168.1.50:554/stream1` (e.g. Tapo C110 — create a
  camera account in the Tapo app under *Advanced → Camera Account*, and use the
  device's LAN IP). Snapshotted with `ffmpeg -rtsp_transport tcp -i <url> -frames:v 1`.
- HTTP: `http://user:pass@192.168.1.51/snapshot.jpg` for cameras exposing a
  single-frame endpoint (Basic auth from the URL is applied automatically).

Multiple cameras are supported; one failing camera never stops the loop. Give
cameras static IPs / DHCP reservations too.

## Telegram setup

1. **Create the bot:** message [@BotFather](https://t.me/BotFather), send `/newbot`,
   follow the prompts, and copy the token into `SAMOGROW_TELEGRAM_TOKEN`.
2. **Get your chat id:** message [@userinfobot](https://t.me/userinfobot) (or send any
   message to your bot and open `https://api.telegram.org/bot<TOKEN>/getUpdates`), and
   put your numeric id in `SAMOGROW_TELEGRAM_CHAT_ID`. The bot ignores everyone else.

### Commands

| Command | Action |
| --- | --- |
| `/status` | Light state, last analysis summary + health score, per-pot line, pump budget, uptime |
| `/photo` | Capture and send photos now |
| `/water <ml>` | Water now (default 100 ml); confirms with an inline button |
| `/light on\|off\|auto [minutes]` | Override the light (default 60 min) or return to schedule |
| `/report` | Send the daily-style digest now (14-day sparklines + week-over-week deltas) |
| `/analyze` | Run an AI check now and reply with the verdict |
| `/timelapse [days]` | Build an MP4 timelapse of camera 0 (default 7 days) and send it |
| `/review` | Run the weekly deep review now |
| `/set [<key> <value>]` | List effective settings, or change one (safe whitelist) |
| `/pump [enable]` | Pump-health status; `/pump enable` clears a lockout |
| `/new` | Reset the conversation history |
| `/help` | List commands |

Alerts and the daily report are pushed to your chat automatically (photo + caption);
an alert comes with **[Water 100 ml] [Ignore]** buttons.

### Just chat with it

Any non-command message goes to Claude (`brain.model`) with tool use, so you can
ask things in plain language and it answers from live data — and can act:

> **You:** how's the basil doing?
> **Bot:** Pot 1 basil is at 8/10, vegetative and lush. No issues since yesterday.
>
> **You:** give it a small drink
> **Bot:** Watered 100 ml. 💧
>
> **You:** actually make it 300ml
> **Bot:** That's above the 200 ml auto-limit — tap to confirm. **[💧 Water 300 ml] [Cancel]**

The model can call the same actions as the slash commands (status, history, photo,
water, light, get/set config) and every action goes through the **same Controller
API and safety caps**. Watering over **200 ml** always asks for a button confirmation
first. The conversation keeps a short rolling history (last ~10 turns); `/new` clears it.

### Growth journal, trends & per-pot tracking

Each analysis records a per-pot breakdown (`species`, `stage`, `health`, `note`) alongside
the whole-garden verdict, and links its photos in a **journal** table. The daily report
and `/report` show 14-day unicode sparklines (`▁▂▃▄▅▆▇█`) for health and water plus
week-over-week deltas in words (e.g. *"health up 1.2 (+18%) vs last week"*). `/timelapse`
stitches the archived JPEGs of camera 0 into a 720p MP4 (2 fps, evenly sampled, capped at
~300 frames) via ffmpeg.

### Weekly deep review

Once a week (`brain.deepReviewDay` / `brain.deepReviewHour`) a **stronger model**
(`brain.deepModel`, default `claude-sonnet-5`) looks at a week of sampled photos plus the
full trend data and returns a husbandry digest — pH/EC checks, thinning, harvest timing,
schedule tweaks. Recommendations that map to a config change come with **[Apply] / [Skip]**
buttons; `/review` triggers it on demand.

### Remote tuning (`/set` + `overrides.json`)

`/set <key> <value>` changes a whitelisted setting at runtime and persists it to
`overrides.json` in `dataDir`, merged over `config.json` on the next load and hot-applied
without a restart. `/set` with no arguments lists the effective values. Settable keys:

- `brain.analysisIntervalMinutes`, `brain.model`, `brain.deepModel`
- `light.onHour`, `light.offHour`
- `pump.maxSecondsPerRun`, `pump.maxSecondsPerDay`

**Safety:** the pump caps can only ever be **lowered** relative to their `config.json`
values, never raised. The per-run / per-day caps stay enforced in the hardware layer for
every caller — bot, brain, conversation tool, or `/set`.

## Calibrating the pump (`mlPerSecond`)

Put the pump's outflow into a measuring cup and run it for a known time — e.g.
`/water` a small amount — then measure the volume:

```
mlPerSecond = millilitres_dispensed / seconds_run
```

Set the result in `config.json` under `pump.mlPerSecond`. Redo this if you change
tubing, head height, or pump/plug. `maxSecondsPerRun` and `maxSecondsPerDay` bound
the worst case, so start conservative.
