# samogrow software

The brain for the samogrow DIY AI herb garden: a camera + Claude vision loop that
watches the plants, controls the grow light and water pump, and reports to (and
takes commands from) a Telegram bot.

Runtime: [Bun](https://bun.sh) + TypeScript (strict). Target device is a 64-bit
Raspberry Pi, but everything also runs on macOS in **mock mode** with zero hardware.

## Architecture

| Module | Responsibility |
| --- | --- |
| `config.ts` | Settings from `config.json`, secrets from env vars |
| `hardware.ts` | Light + pump switches (GPIO via `pinctrl`/`gpioset`, or a Kasa smart plug); pump safety caps |
| `camera.ts` | One timestamped JPEG per camera into the photo dir |
| `state.ts` | `bun:sqlite` store of events + analyses |
| `brain.ts` | Claude vision analysis → strict, clamped JSON verdict |
| `controller.ts` | The minute loop: light schedule, periodic analysis, daily report, bot API |
| `bot.ts` | grammY Telegram bot (owner-only) |
| `main.ts` | Wires it together; graceful shutdown |

Safety is enforced in code, not by the model: the pump clamps every run to
`maxSecondsPerRun` and a per-day `maxSecondsPerDay` budget (reset at midnight) and
always turns off in a `finally`; the brain's `waterTopUpMl` is validated and capped
at 500 ml before it can act.

## Run on a Mac (mock mode)

```sh
cd software
bun install
SAMOGROW_MOCK=1 bun run src/main.ts   # no hardware, log-only switches, placeholder photos
```

With no Telegram token set it runs headless (controller only) and logs its
light-schedule decisions. Quality gates:

```sh
bun install
bunx tsc --noEmit
bun test
```

## Run on a Raspberry Pi

1. Clone the repo to `/home/pi/samogrow` (so the layout is `/home/pi/samogrow/software`).
2. `cd /home/pi/samogrow/software && ./deploy/install.sh` — installs Bun, dependencies,
   camera/GPIO tools, and the systemd unit.
3. Create `/home/pi/samogrow/.env` from `software/.env.example`.
4. Optionally create `config.json` from `config.example.json` and tune pins/schedule.
5. `sudo systemctl start samogrow` and watch with `journalctl -u samogrow -f`.

GPIO output is active-high. On a Pi 5 the code uses `pinctrl`; on older images it
falls back to `gpioset`. To drive the light via a TP-Link Kasa smart plug instead
of a relay, set `light.kasaHost` to the plug's IP (spoken to directly over TCP 9999).

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
`/water` a small amount, or run the pump for 10 s — then measure the volume:

```
mlPerSecond = millilitres_dispensed / seconds_run
```

Set the result in `config.json` under `pump.mlPerSecond`. Redo this if you change
tubing, head height, or pump voltage. `maxSecondsPerRun` and `maxSecondsPerDay` bound
the worst case, so start conservative.
