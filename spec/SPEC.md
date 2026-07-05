# samogrow — Build Spec

**Version:** v1.0
**Date:** 2026-07-04
**Owner:** Nik (nik@postgres.ai)
**Status:** Ready to build

A DIY, AI-controlled indoor hydroponic herb garden — always-fresh parsley and
greens on a countertop or shelf. An affordable, open, kit-style alternative to
Auk, Click & Grow, and (the real target) Gardyn. Off-the-shelf hydroponics parts
+ a Raspberry Pi 5 + a camera + a Claude vision brain that watches the plants,
controls light and watering, and reports/accepts commands over Telegram.

---

## 1. Goal & why

**Goal:** grow a continuous supply of parsley and leafy herbs indoors, year-round,
with the plant care automated and monitored by AI — for a one-time hardware cost
in the low hundreds of dollars and **no subscription**.

**Why DIY instead of buying a smart garden:** the commercial market is built on the
razor-and-blades trap (see `research/01-commercial-analogs.md`). Every premium
brand monetizes proprietary pods and/or a mandatory membership:

- Click & Grow: ~$150–250/yr in proprietary pods + subscription.
- Gardyn (the only commercial unit with real camera+AI): **$899 hardware + a
  $29–39/mo Kelby AI membership (~$408/yr)** — 3-year TCO north of $2,500.
- Lettuce Grow: $200–400/yr consumables.

The AI-camera tier is exactly the feature people pay the most for, and only Gardyn
ships it. A Raspberry Pi + a cheap camera + Claude Haiku vision delivers the same
capability (plant-health checks, watering/lighting decisions, harvest nudges) for
**~$3–7/month in API calls and zero recurring fees**, on **open, commodity
consumables** (bulk seeds, rockwool, generic 2-part nutrient) that cost a few
dollars per grow cycle. That open-consumables design is our single biggest
structural advantage, and it sidesteps the vendor-lock-in / brand-stability risk
that stranded AeroGarden owners.

**Non-goals for v1:** no proprietary pods, no hand-wired mains relays, no local LLM
on the Pi, no over-designed enclosure.

---

## 2. User stories

Nik is the user. He wants:

1. **Fresh parsley and greens on tap.** Parsley, basil, cilantro, and lettuce
   growing continuously so there's always something to cut for cooking — not a
   single harvest.
2. **Telegram control and reports.** A daily photo + health note pushed to
   Telegram; inline buttons to water now / get a report; the ability to ask "how
   do the plants look?" from his phone. The bot obeys only his chat ID.
3. **DIY but practical.** He wants to build and understand it, but it should be
   reliable enough to leave running for weeks (systemd, watchdog, SD-card
   protection, Tailscale for remote access).
4. **Price-sensitive but quality-minded.** Beat the commercial units on cost and
   on openness, but don't cut corners on the things that cause real failures:
   quiet pump, even full-spectrum light, no algae, no fire risk.
5. **Safety first on mains.** The grow light switches through a UL-listed smart
   plug — Nik is not an electrician and will not hand-wire 120 V.

---

## 3. Architecture

Growing method (per `research/02-hydroponics-parts.md`): **Deep Water Culture
(DWC)** in a shared opaque tote — roots sit in aerated nutrient solution, an air
pump + air stone oxygenate 24/7, and a plain-water top-up jug keeps the level up
via a small 12 V pump triggered by a float switch. DWC beats Kratky here because
continuous-harvest herbs (parsley, basil, mint) need oxygen at the roots the whole
time, and because automated top-up is native to DWC (in Kratky, topping up defeats
the mechanism). One reservoir, ~6 net cups, one nutrient batch — the simplest thing
for the AI to monitor and dose.

The only mains switching is the grow light, done through a **Kasa/Tapo smart plug**
(UL-listed, no wiring). Everything on the Pi's GPIO is low-voltage: a 12 V top-up
pump driven by a MOSFET module off a **separate 12 V supply**, and a float switch
for low-water protection.

```
                          120 V WALL OUTLET
                                 |
                    +------------+------------+
                    |                         |
             [Kasa smart plug]         [12V DC PSU]  [Pi 27W USB-C PSU]
             (Wi-Fi, UL-listed)            |               |
                    |                      | 12V rail      | 5V
              [LED grow light]             |               |
              Barrina T5 strips            |               |
                    |                      v               |
        ~~~~~~~~~~~~|~~~~~~~~~~~~     [MOSFET module]       |
        :   light over canopy  :      gate<--- GPIO27 -----+
        :                      :        |                  |
        :  [net cups x6]       :   [12V top-up pump]       |
        :   parsley/basil/     :        |  ^               |
        :   cilantro/lettuce   :        |  | plain water   |
        :   in rockwool+LECA   :        v  |               |
        :                      :   [top-up jug]            |
        :  === nutrient  ===   :                           |
        :  === solution  ===<--------- pumped top-up       |
        :   (opaque DWC tote)  :                           |
        :     |          |     :                           |
        :  [air stone] [float switch]---- GPIO22 ----------+
        :     ^              (low-water)                    |
        :~~~~~|~~~~~~~~~~~~~~~~~:                            |
              |                                        [Raspberry Pi 5]
        [air pump 24/7]        [Pi Camera 3 Wide]---CSI---> - reads camera
                                    (over canopy)           - drives GPIO27 pump
                                                            - reads GPIO22 float
                                                            - toggles Kasa (Wi-Fi)
                                                            - runs Telegram bot
                                                                  |
                                          +-----------------------+------+
                                          |                              |
                                   [Claude API]                   [Telegram]
                                 Haiku vision:                 daily photo +
                                 photo -> JSON verdict         report, /commands
                                 {water, light_hours,          (obeys Nik's
                                  health_notes, confidence}     chat id only)
```

Data flow: on a timer during light hours the Pi captures a photo, POSTs it to the
Claude API, gets a structured JSON verdict, applies watering/lighting decisions
within hard safety caps, and pushes results to Telegram. Remote access to the Pi
is over Tailscale; the SD card is protected with log2ram + a systemd watchdog.

### 3a. Alternative path (documented, not chosen)

The locked decision is a **custom TypeScript/Bun service on the Pi** (Nik's
mandate). Two credible alternatives were evaluated in
`research/04-software-stack.md` and rejected for this build:

- **Mycodo + a thin AI service.** Mycodo (Pi-native) hands you proven
  relay/PID/camera/scheduling code and a real dashboard for free; you bolt an AI
  layer on via MQTT. Best "don't reinvent the safety-critical parts" option — but
  it's a full Flask app + daemon, heavier than a single-purpose appliance needs,
  and it's Python.
- **Home Assistant + ESPHome.** Put sensors/relays on cheap ESP32 nodes instead of
  Pi GPIO; HA gives entities, automations, and mobile notifications. Bigger stack,
  less direct AI integration.
- **OpenClaw as the brain: rejected outright.** It's a general-purpose
  personal-agent gateway (400–800 MB idle, constant flash writes, broad system
  access) — wrong shape and weight, and a materially larger attack surface for an
  internet-reachable appliance.

The custom Bun service is the lightest, most auditable option and keeps the attack
surface to "call Claude + toggle one plug + drive two GPIO pins."

---

## 4. Bill of materials

Prices are USD, mid-2026. Items marked **(est.)** are market-typical estimates
carried over from the research files (Amazon renders prices in JavaScript, so live
figures weren't machine-readable); expect ±30% from coupons/sellers. Verify at the
linked source before buying. Sources: `research/02-hydroponics-parts.md` (grow
side) and `research/03-electronics.md` (electronics).

Two tiers: **Core build** is everything needed for a working AI garden.
**Nice to have** is the second-tier upgrades (extra sensing, dosing, a second
camera) that the software already anticipates.

### 4a. Core build — electronics / controller

| Part | Suggested product | Est. price | Source |
|---|---|---:|---|
| Controller | Raspberry Pi 5 (4GB) | **$75** | PiShop.us / CanaKit (rpilocator.com for stock) |
| Power | Official 27 W USB-C PSU | **$12** | Raspberry Pi authorized reseller |
| Boot media | 32 GB A2 microSD | **$9** (est.) | any |
| Cooling | Pi 5 case with active cooler | **$12** (est.) | The Pi Hut / CanaKit |
| Camera | Pi Camera Module 3 **Wide** (120°) | **$35** (est.) | Raspberry Pi authorized reseller |
| Camera cable | Pi 5 22-pin ↔ 15-pin adapter cable | **$5** (est.) | (Pi 5 uses the mini CSI connector) |
| Light switch | Kasa EP25 smart plug (UL-listed) | **$15** | kasasmart.com (cheaper in 2-packs) |
| Top-up pump | 12 V submersible pump | **$12** (est.) | e.g. Gikfun 12 V |
| Pump driver | Logic-level MOSFET module (IRLZ44N / IRF520) | **$5** (est.) | incl. flyback diode — verify |
| Pump power | 12 V 2–3 A DC PSU + barrel-jack adapter | **$14** (est.) | any |
| Low-water | Float switch (GPIO digital) | **$6** (est.) | any |
| Wiring | Jumper wires + half-size breadboard | **$11** (est.) | any |
| Wiring | 22 AWG hookup wire | **$8** (est.) | any |
| Enclosure | Electronics project box | **$15** (est.) | keep the Pi out of the humid zone |
| | **Electronics subtotal** | **~$234** | |

### 4b. Core build — grow side

| Part | Suggested product | Est. price | Source |
|---|---|---:|---|
| Reservoir | Opaque food-safe tote, ~5–7 gal | **$12** (est.) | must be opaque (algae) — drill 3" holes |
| Net cups | 3" net pots, 25-pack | **$13** (est.) | Amazon |
| Starter plugs | Grodan A-OK 1.5" rockwool, 50 ct | **$12** (est.) | Amazon |
| Grow media | Hydroton / LECA clay pebbles, ~10 L | **$20** (est.) | reusable, rinse first |
| Air pump | Adjustable aquarium air pump, dual outlet | **$15** (est.) | quiet, low power |
| Air stone | Air stone / disc diffuser, 2-pack | **$8** (est.) | Amazon |
| Airline | Silicone airline 25 ft + check valve | **$7** (est.) | check valve stops back-siphon |
| Top-up jug | 1–2 gal jug for plain-water feed | **$6** (est.) | Amazon |
| Nutrient | MasterBlend 4-18-38 Combo Kit, 2.5 lb | **$28** (est.) | makes ~180 gal — outlasts the build |
| pH | GH pH Control Kit (Up/Down + indicator) | **$22** (est.) | target pH 5.5–6.5 |
| Grow light | Barrina T5 2 ft full-spectrum strips, 4-pack | **$40** (est.) | ~20 W/strip, linkable, even coverage |
| Seeds | Parsley + basil + cilantro + lettuce packets | **$15** (est.) | Sow Right / Botanical Interests |
| | **Grow-side subtotal** | **~$198** | |

### 4c. Core build grand total

| Section | Est. cost |
|---|---:|
| Electronics / controller | ~$234 |
| Grow side | ~$198 |
| **Core build total** | **~$432** |

### 4d. Nice to have (upgrades)

The software (`software/src/config.ts`) already anticipates most of these — a
second camera, a dosing pump, additional sensors.

| Add-on | Product | Est. price |
|---|---|---:|
| Temp/humidity | SHT31 sensor (I²C, 3.3 V native) | **$12** (est.) |
| Second camera | 2nd Camera Module 3 or USB webcam | **$30** (est.) |
| Nutrient dosing | 12 V peristaltic dosing pump | **$13** (est.) |
| Water level (continuous) | XKC-Y25 non-contact level + level shifter | **$14** (est.) |
| Light sensor | BH1750 (I²C) | **$8** (est.) |
| Cleaner wiring | GPIO screw-terminal / proto HAT | **$12** (est.) |
| pH precision | Digital pH pen | **$15** (est.) |
| Second load switch | Second Kasa/Tapo smart plug (fan, etc.) | **$15** (est.) |
| | **Nice-to-have delta** | **~$119** |

### 4e. Yearly consumables

Almost everything is a one-time kit that lasts many grows. Ongoing cost is low:

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
| **samogrow (core)** | ~$432 | ~$70 consumables + ~$120 Claude API ($5/mo) | **Yes** | **~$622** |
| Gardyn Home 4 | ~$899 | ~$816 (Kelby AI $34/mo) | Yes | **~$1,715** |
| Click & Grow SG9 | ~$200 | ~$400 (pods + sub) | No | **~$600** |
| Auk Mini 2 | ~$229 | ~$0 (bring your own seeds) | No (scheduling only) | **~$229** |

Takeaways: samogrow is **~$1,090 cheaper than Gardyn over two years** while
delivering the same camera+AI capability with no subscription and no pod lock-in.
It lands near a Click & Grow SG9's 2-year cost but adds the AI monitoring and open
consumables the SG9 doesn't have, and grows more plants. Auk Mini 2 is cheaper but
is 4 pots, no camera, no AI — a scheduling timer, not a monitor. The DIY premium
over the cheapest countertop units buys the one feature (AI vision) that only the
$899 Gardyn otherwise offers.

---

## 5. Assembly plan

### Day 0 — order everything

Place the full core-build order (see `spec/SHOPPING-LIST.md` for the flat,
copy-paste list). Buy the Pi and camera from an authorized reseller
(PiShop.us, CanaKit, Adafruit, The Pi Hut); check rpilocator.com for stock. If you
want the low-friction path, a CanaKit Pi 5 starter kit (~$130) bundles the board +
27 W PSU + SD + active-cooler case and replaces the first four electronics rows.

### Day 1–2 — start germination IMMEDIATELY

**Parsley is the bottleneck: germination takes 10–28 days.** Start seeds the moment
they arrive — before you build anything — or the plants will lag the hardware by
weeks.

1. **Soak parsley seeds** in warm water 12–24 h (change the water once) to leach
   out the coumarin germination inhibitors.
2. Rinse/pH-condition rockwool plugs. Sow soaked parsley + basil + cilantro +
   lettuce into separate plugs. Optionally pre-germinate parsley on a damp paper
   towel and transfer sprouted seeds.
3. Keep plugs **~70 °F (21 °C) and constantly moist** — one dry-out kills
   germinating parsley. Basil sprouts in 5–7 days; parsley in 10–28.
4. Use a slow-bolt cilantro (Calypso/Santo) and flat-leaf "Giant of Italy"
   parsley. For mint, use a rooted cutting (not seed) in its own cup at one end.

### Day 2–4 — build the DWC reservoir

1. Drill six 3" holes in the opaque tote lid for net cups.
2. Rinse the LECA pebbles (dusty). Rinse rockwool.
3. Run airline from the air pump → check valve → air stone in the bottom of the
   tote. **Keep the air pump above the water line** (or use the check valve) so it
   can't back-siphon.
4. Mount the float switch through the tote wall at the low-water mark.
5. Position the top-up jug **above** the reservoir; run the 12 V pump's outlet
   tubing into the tote.
6. Mix nutrient per MasterBlend directions (all three parts, never combine
   concentrates undiluted) to a mild solution (EC ~1.0–1.6 / ~700–1100 ppm).
   Adjust pH to 5.5–6.5 with the GH kit.

### Day 4–5 — light + camera mount

1. Mount the Barrina strips 15–30 cm above the canopy, spaced across the shelf for
   even coverage. Make the height **adjustable** (avoid Click & Grow's fixed-height
   flaw that blocks tall crops). Plug the light into the Kasa plug, Kasa into wall.
2. Mount the Pi Camera Module 3 Wide over the tray, framing all six cups from short
   range (the 120° wide lens is chosen for exactly this short standoff).
3. Keep the Pi and all bare boards in the project-box enclosure, **outside/above**
   the humid zone, with only the camera ribbon and sensor leads running in. Use
   drip loops on every cable.

### Day 5 — low-voltage wiring

See §6 for the pin map. Wire the MOSFET module and float switch to the Pi GPIO,
the pump to the **separate 12 V rail** (common ground with the Pi only). Verify the
flyback diode across the pump (cathode to +12 V). **No mains touches the Pi** — the
light is on the Kasa plug.

### Day 5–6 — software on the Pi

1. Flash Raspberry Pi OS (64-bit) to the SD card; enable SSH.
2. Install Bun: `curl -fsSL https://bun.sh/install | bash`.
3. Clone the repo, `cd software`, `bun install`.
4. Create `.env` with `SAMOGROW_TELEGRAM_TOKEN`, `SAMOGROW_TELEGRAM_CHAT_ID`,
   `ANTHROPIC_API_KEY` (readable only by the service user). Get the bot token from
   **BotFather**; get your chat id from the bot's first message.
5. Create `config.json` with your Kasa plug's IP (`light.kasaHost`), pump
   calibration, and light schedule (defaults in `config.ts`).
6. Install as a **systemd service** (`Restart=always`, `WatchdogSec`), enable
   **log2ram** to spare the SD card, and put the Pi on **Tailscale** for remote
   SSH/checks without opening ports. Optionally enable the hardware watchdog.
7. Transplant sprouted plugs into net cups (surround with LECA) once they have
   roots + true leaves.

---

## 6. Wiring diagram (low-voltage side)

Pin numbers are **BCM** and match the defaults in `software/src/config.ts`
(`light.gpioPin: 17`, `pump.gpioPin: 27`). Because the grow light is on a Kasa
plug, **GPIO17 is left unused** (set `light.kasaHost` and the code skips the pin).

```
  Raspberry Pi 5 GPIO (BCM numbering)
  ┌─────────────────────────────────────────────────────────────┐
  │  3V3  ●  ●  5V                                                │
  │ GPIO2 ●  ●  5V     GPIO2 (SDA) ──┐  I2C for optional SHT31    │
  │ GPIO3 ●  ●  GND    GPIO3 (SCL) ──┘  (nice-to-have)           │
  │ GPIO4 ●  ●  GPIO14                                            │
  │  GND  ●  ●  GPIO15                                            │
  │ GPIO17●  ●  GPIO18   GPIO17 = light relay (UNUSED — Kasa)     │
  │ GPIO27●  ●  GND      GPIO27 ── pump MOSFET gate ──────────┐   │
  │ GPIO22●  ●  GPIO23   GPIO22 ── float switch (pull-up) ──┐ │   │
  │  ...                                                    │ │   │
  └────────────────────────────────────────────────────────┼─┼───┘
                                                            │ │
        +12V RAIL (separate PSU) ─────────────┐            │ │
                                              │            │ │
   [12V DC PSU] ── +12V ──┬──────────────┐   │            │ │
                          │          [pump +]  │           │ │
                          │          [pump -]──┤           │ │
                          │              │  [MOSFET module] │
                          │              │   SIG ◄──────────┘   (from GPIO27)
                          │  flyback     │   VCC/GND
                          │  diode across pump                     │
                          │  (cathode → +12V)                      │
   COMMON GND ────────────┴──────────── Pi GND ─────────────────── ┘
                          │
                    [float switch] ── one leg → GPIO22, other leg → GND
                    (Pi internal pull-up; closed = water OK / open = low)
```

Rules that keep this safe (from `research/03-electronics.md`):

- **Never run the pump off the Pi's 5 V rail.** Separate 12 V PSU, common ground
  only.
- **Flyback diode across every pump/motor**, cathode to +12 V — many MOSFET modules
  include one; verify.
- **Pi GPIO is 3.3 V and not 5 V-tolerant.** The float switch reads to GND with the
  Pi's internal pull-up (fine). Any 5 V sensor (XKC-Y25, ultrasonic) needs a level
  shifter.
- **No hand-wired 120 V anywhere.** The grow light is on the Kasa plug.

---

## 7. Implementation details

The service is a small TypeScript/Bun app (`software/`) using `@anthropic-ai/sdk`
for Claude vision and `grammy` for Telegram. Config shape is in
`software/src/config.ts`; secrets come from env, settings from `config.json`.

### The control loop

During light hours (`light.onHour`..`light.offHour`, default 07:00–23:00, a 16 h
photoperiod for leafy herbs), every `brain.analysisIntervalMinutes` (default 120):

1. **Capture** a photo from the camera (`cameras.devices`, default `picamera:0`,
   1920×1080).
2. **Analyze** — POST the image to Claude Haiku
   (`brain.model`, default `claude-haiku-4-5-20251001`) with a stable, cached
   system prompt (plant profiles + rules + schema) and get a **structured JSON
   verdict**, e.g. `{ water: bool, light_hours: number, health_notes: string,
   confidence: number }`. Use the SDK's structured-output support
   (`output_config.format` with a JSON schema) so each analysis returns a typed
   object; keep the system prompt cached (`cache_control`) so per-image cost is
   dominated by the ~1,600 image tokens, not the instructions.
3. **Decide + act, within hard safety caps:**
   - *Watering:* if the verdict says water **and** the float switch reads low,
     run the top-up pump on GPIO27 — but never longer than
     `pump.maxSecondsPerRun` (30 s) per run and never more than
     `pump.maxSecondsPerDay` (180 s) total per day. `pump.mlPerSecond` (15,
     calibrate with a measuring cup) converts seconds→volume. **These caps are the
     anti-flood backstop: the AI can request water, it cannot override the cap.**
   - *Lighting:* adjust the photoperiod within the configured schedule; toggle the
     Kasa plug over Wi-Fi (`light.kasaHost`). If low confidence, prefer the
     schedule over the model.
4. **Report** — push the photo + `health_notes` to Telegram, plus inline buttons
   ("Water now", "Report"). A daily digest goes out at `brain.dailyReportHour`
   (09:00). The bot only obeys `telegramChatId`.

### Config knobs (`config.ts`)

| Knob | Default | Purpose |
|---|---|---|
| `light.onHour` / `offHour` | 7 / 23 | 16 h photoperiod |
| `light.kasaHost` | (set this) | if present, use the Kasa plug (skip GPIO17) |
| `pump.gpioPin` | 27 | MOSFET gate |
| `pump.maxSecondsPerRun` | 30 | per-run flood cap |
| `pump.maxSecondsPerDay` | 180 | daily flood cap (hard) |
| `pump.mlPerSecond` | 15 | calibrate before trusting volume |
| `cameras.devices` | `["picamera:0"]` | add `picamera:1` / `/dev/video0` for a 2nd cam |
| `brain.model` | `claude-haiku-4-5-20251001` | Haiku for the routine loop |
| `brain.analysisIntervalMinutes` | 120 | photo + AI cadence |
| `brain.dailyReportHour` | 9 | daily Telegram digest |
| `mockHardware` | false | dev mode — no GPIO/camera needed |

### Cost model

Per analysis ≈ 2,100 input tokens (image + cached prompt) + ~300 output ≈
**~$0.0036** on Haiku. At 24 images/day → **~$2.6/mo**; 48/day → **~$5.2/mo**.
Budget **~$3–7/mo** including retries. Escalate to Sonnet only for a weekly deep
review or when Haiku's confidence is low — running everything on Sonnet would be
~3× (~$8–16/mo), not worth it for hourly checks.

---

## 8. Tests plan

### Software (already in repo)

- `bun test` — unit tests.
- `bunx tsc --noEmit` — typecheck.
- **Mock mode first:** `SAMOGROW_MOCK=1 bun run src/main.ts` (`bun run dev`) runs
  the full loop with no GPIO/camera hardware — validate the Claude call, JSON
  parsing, decision logic, and Telegram push on your Mac before touching the Pi.

### Hardware bring-up checklist (do in order, on the Pi)

1. **Camera check:** capture a still, confirm the whole tray is framed and in focus
   under the grow light.
2. **Float switch:** watch the GPIO22 read as you raise/lower the water — confirm
   closed = OK, open = low.
3. **Pump calibration:** run the pump for a measured 10 s into a measuring cup;
   divide ml by seconds to set `pump.mlPerSecond`. Confirm the day-cap stops it.
4. **Light schedule dry-run:** command the Kasa plug on/off from the Pi
   (`python-kasa`-style discovery, or the service's toggle) and confirm the light
   responds within ~1–2 s.
5. **Safety caps:** force a "water" verdict repeatedly and confirm the pump refuses
   past `maxSecondsPerDay`.
6. **Kill test:** stop the service; confirm systemd restarts it and the watchdog
   recovers a hung process.

---

## 9. Team of veteran experts

Before shipping, the spec was run past an imaginary review panel. Their top
concerns, and how the design answers them:

- **The hydroponics grower** (20 years, mostly basil and lettuce): *"Continuous-
  harvest herbs die of root suffocation, not thirst. Don't Kratky this."* →
  Addressed: DWC with a 24/7 air stone, not a passive air-gap system. *"And your
  tote had better be opaque or you'll grow more algae than parsley."* → Opaque tote
  is a hard requirement in the BOM.
- **The electronics safety engineer:** *"The single thing that can burn the house
  down is a hand-wired mains relay on a breadboard."* → No mains wiring anywhere;
  the light switches through a UL-listed smart plug. *"And don't run a motor off the
  Pi's 5 V rail or feed an inductive spike back into GPIO."* → Separate 12 V PSU,
  common ground, flyback diode across the pump, 3.3 V-only GPIO with level shifting
  for any 5 V sensor.
- **The SRE:** *"Appliances fail on flash wear and hung processes, and you'll want
  to fix it from your phone."* → log2ram + optional overlay FS for the SD card,
  systemd `Restart=always` + watchdog, Tailscale for keyed remote access with no
  open ports. *"Secrets don't go in the repo."* → API key and bot token live in an
  env file readable only by the service user; the bot obeys one chat id.

---

## 10. Sprint plan

**Week 1 — order, germinate, software in mock mode.**
Place the Day-0 order. The moment seeds arrive, start germination (parsley first —
it's slow). In parallel, on the Mac: `bun install`, get the bot from BotFather,
run the loop in `SAMOGROW_MOCK=1` mode, verify the Claude vision call + JSON verdict
+ Telegram push all work end-to-end against a sample plant photo.

**Week 2 — assemble and deploy.**
Build the DWC reservoir, mount the light and camera, do the low-voltage wiring per
§6. Flash the Pi, install Bun + the service as a systemd unit, set up log2ram +
Tailscale, wire `config.json` to the Kasa plug. Run the §8 hardware bring-up
checklist. Transplant sprouted plugs.

**Week 3+ — tune with real plants.**
Calibrate `mlPerSecond`, tune the photoperiod and analysis cadence, refine the
system prompt against real growth, and decide which nice-to-have upgrades (SHT31,
peristaltic dosing, second camera) are worth adding.

---

## 11. Changelog

- **v1.0 (2026-07-04)** — Initial build spec. DWC + auto top-up growing method;
  Raspberry Pi 5 (4GB) + Camera Module 3 Wide; Kasa smart plug for the light; 12 V
  pump via MOSFET + separate PSU; float switch for low-water. Custom TypeScript/Bun
  service with Claude Haiku vision and grammY Telegram bot. Core-build BOM ~$432,
  nice-to-have delta ~$119, consumables ~$35/yr, Claude API ~$3–7/mo.
