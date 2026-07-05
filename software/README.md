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
| `hardware.ts` | Light + pump smart-plug switches (Kasa local protocol); pump safety caps |
| `camera.ts` | One timestamped JPEG per camera (RTSP via ffmpeg, or HTTP snapshot) |
| `state.ts` | `bun:sqlite` store of events + analyses |
| `brain.ts` | Claude vision analysis → strict, clamped JSON verdict |
| `controller.ts` | The minute loop: light schedule, periodic analysis, daily report, bot API |
| `bot.ts` | grammY Telegram bot (owner-only) |
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

v1 speaks the **Kasa** local protocol directly (TCP 9999). Use a Kasa-class plug
— **KP115 / EP10 / HS103**. Set `light.plugHost` / `pump.plugHost` to each plug's
LAN IP. Give the plugs **static IPs or DHCP reservations** so the addresses don't
change. **Tapo** plugs use an encrypted KLAP handshake and are not supported in
v1 (setting `plugType: "tapo"` throws with guidance); use a Kasa plug, or drive a
Tapo plug from an external CLI.

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
| `/status` | Light state, last analysis summary + health score, pump budget used, uptime |
| `/photo` | Capture and send photos now |
| `/water <ml>` | Water now (default 100 ml); confirms with an inline button |
| `/light on\|off\|auto [minutes]` | Override the light (default 60 min) or return to schedule |
| `/report` | Send the daily-style digest now |
| `/analyze` | Run an AI check now and reply with the verdict |
| `/help` | List commands |

Alerts and the daily report are pushed to your chat automatically (photo + caption);
an alert comes with **[Water 100 ml] [Ignore]** buttons.

## Calibrating the pump (`mlPerSecond`)

Put the pump's outflow into a measuring cup and run it for a known time — e.g.
`/water` a small amount — then measure the volume:

```
mlPerSecond = millilitres_dispensed / seconds_run
```

Set the result in `config.json` under `pump.mlPerSecond`. Redo this if you change
tubing, head height, or pump/plug. `maxSecondsPerRun` and `maxSecondsPerDay` bound
the worst case, so start conservative.
