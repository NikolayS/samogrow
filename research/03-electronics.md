# Electronics & Controller Research — AI Hydroponic Herb Garden

Research date: 2026-07-04. Buyer: US, prices in USD. Prices marked **(est.)** are
my estimate from typical street pricing / historical data where a live figure
wasn't found; treat them as ballpark. Prices marked with a citation are from a
source found during research (linked at the bottom of each section).

**Context that drives the choices:** the Pi does *not* run heavy local AI. It
captures images, POSTs them to a cloud vision API, toggles GPIO/relays or smart
plugs, and runs a Telegram bot 24/7. That is a light workload — CPU is almost
never the bottleneck. The real design constraints are: (a) camera interface
(CSI vs USB, and whether you want *two* cameras), (b) RAM headroom for Python +
image buffers, and (c) doing mains switching **safely** as a non-electrician.

---

## TL;DR recommendation

- **Controller: Raspberry Pi 5 (4GB).** Native dual-CSI (two Camera Module 3s),
  plenty of RAM headroom, current-gen support. A Pi Zero 2 W ($15) technically
  does the job but 512MB RAM and single (mini) CSI make it fiddly; a Pi 4 is
  fine but no longer meaningfully cheaper than a Pi 5 in 2026.
- **Camera: 1× Pi Camera Module 3 Wide** (120°) to frame a whole grow tray from
  short range. Add a second Module 3 only if you want two angles.
- **Mains switching (grow light): a Kasa/Tapo smart plug over Wi-Fi**, not a bare
  relay board. No mains wiring, UL-listed, controlled from Python. This is the
  single most important safety call in the build.
- **Low-voltage pump: 12V peristaltic dosing pump + a MOSFET/relay module** (with
  flyback diode) on a separate 12V supply — never on mains.
- **Sensors: start camera-only.** Add a float/non-contact water-level sensor and
  one SHT31 temp/humidity sensor as a cheap, high-value second tier. Skip TDS/EC
  unless you're seriously tuning nutrients.

---

## 1. Compute: Pi 5 vs Pi 4 vs Pi Zero 2 W

### The workload is light
Capturing a JPEG, uploading it to a cloud API, waiting for a response, posting to
Telegram, and flipping a GPIO pin is trivial compute. **Any** of these three
boards has enough CPU. The decision is really about **camera interface, RAM, and
2026 pricing** — not horsepower.

### 2026 pricing reality (important)
LPDDR4 memory prices spiked hard in early 2026, and Raspberry Pi raised board
prices twice. As of mid-2026:

| Board | RAM | Board price | Notes |
|---|---|---|---|
| Pi Zero 2 W | 512MB | **$15** | Single *mini* CSI, needs adapter cable, no Ethernet |
| Pi 4 (4GB) | 4GB | **~$55 (est.)** | Single CSI, older platform |
| Pi 4 (8GB) | 8GB | **~$75 (est.)** | |
| Pi 5 (2GB) | 2GB | **~$50 (est.)** | Dual CSI |
| Pi 5 (4GB) | 4GB | **$75** | Dual CSI — **recommended** |
| Pi 5 (8GB) | 8GB | **$95** | |
| Pi 5 (16GB) | 16GB | **$205–305** | Overkill; avoid, priced up by DRAM shortage |

Key takeaway: **the Pi 4 is no longer a real cost saving** over the Pi 5 in 2026 —
a 4GB Pi 5 (~$75) is roughly the price of a 4GB Pi 4 plus you get dual native
cameras, faster USB, and current-gen support. The only genuinely cheap board is
the Zero 2 W at $15.

### Accessory costs (each board needs these)

| Item | Pi 5 | Pi 4 | Zero 2 W | Notes |
|---|---|---|---|---|
| Official PSU | **$12** (27W USB-C) | ~$8 (15W USB-C) | ~$8 (micro-USB) | Pi 5 wants the 27W for full USB power |
| microSD (32GB A2) | **~$9 (est.)** | ~$9 | ~$9 | Or boot from USB/NVMe |
| Case | **~$10–15** | ~$8 | ~$6 | Pi 5 case with active cooler recommended |
| CSI adapter cable | included/std | std | **needs mini-CSI adapter (~$1–3)** | Zero uses the smaller connector |
| **Board+PSU+SD+case subtotal** | **~$105–110** | **~$80 (est.)** | **~$40 (est.)** | |

A **CanaKit Pi 5 starter kit** (board + 27W PSU + SD + active-cooler case +
HDMI) runs **~$130** and is the low-friction way to buy for the Pi 5.

### Verdict per board

- **Pi Zero 2 W ($15 board, ~$40 built)** — *Good/budget.* Quad-core is enough for
  the workload and it sips power (nice for 24/7). **Downsides:** 512MB RAM is
  tight once you're running Python, Picamera2, image buffers, and a Telegram bot —
  you'll want a swap file and lean code, and two cameras is impractical. Uses the
  smaller mini-CSI connector (adapter needed) and has only one camera port. Wi-Fi
  only (fine here). Best if you want the cheapest possible always-on box and only
  one camera.
- **Pi 4 (4GB)** — *Fine but no longer the value pick.* Works great, single CSI
  port (one native camera; more only via USB or an Arducam multiplexer). In 2026
  it costs about the same as a Pi 5, so there's little reason to choose it new.
- **Pi 5 (4GB)** — **Recommended.** Native **two** CSI connectors (first Model B
  to do this), 4GB RAM gives comfortable headroom, faster I/O, current support
  through the rest of the decade. The extra ~$35 over a Zero-based build buys you
  a much less fiddly project and a clean path to two cameras.

> Buy from authorized resellers (PiShop.us, CanaKit, Adafruit, The Pi Hut) and
> check **rpilocator.com** for live stock/price across retailers.

Sources:
[Pi 5 price rises / SKUs](https://www.raspberrypi.com/news/1gb-raspberry-pi-5-now-available-at-45-and-memory-driven-price-rises/) ·
[Pi 5 16GB $205 price hike (Tom's Hardware)](https://www.tomshardware.com/raspberry-pi/raspberry-pi-5-price-increases-drastically-as-ai-shortage-bites-16gb-version-now-usd205-second-price-increase-in-three-months-over-70-percent-more-expensive-than-original-msrp) ·
[Pi 5 updates April 2026](https://fazm.ai/blog/raspberry-pi-5-updates-april-2026) ·
[Zero 2 W $15 / in production to 2030](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/) ·
[Which Pi to buy 2026](https://pcbsync.com/which-raspberry-pi-to-buy/) ·
[CanaKit Pi 5 kit](https://www.canakit.com/raspberry-pi-5)

---

## 2. Cameras

### Pi Camera Module 3 vs USB webcam

| | Pi Camera Module 3 | Pi Camera Module 3 **Wide** | Cheap USB webcam (Logitech C270) |
|---|---|---|---|
| Sensor | 12MP Sony IMX708 | 12MP IMX708 | 0.9MP (720p) |
| Field of view | 75° | **120°** | ~55° |
| Autofocus | **Yes (PDAF)** | Yes | Fixed focus |
| HDR / low light | Good | Good | Weak |
| Price | **~$25 (est.)** | **~$35 (est.)** | **~$18–25** (C270) |
| Interface | CSI ribbon | CSI ribbon | USB-A |
| Cable length | ~15–30cm ribbon (up to ~1m with special cables) | same | **1–2m+ USB, extendable** |

**For plant monitoring, the Camera Module 3 wins on image quality** — 12MP,
autofocus (keeps leaves sharp as they grow toward the lens), HDR and better
low-light behavior all matter under a grow light. The **Wide (120°)** version is
the pick for an enclosed grow tray: it frames the whole tray from short range,
where a 75° lens would need more standoff distance than a cabinet allows.

**USB webcams** (Logitech C270 ~$18–25) are the pragmatic choice if you want a
**long cable run** (the CSI ribbon is short — practically <30cm without special
long-run cables), plug-and-play on any Pi, or don't want to deal with ribbon
connectors. Image quality is clearly lower (720p, fixed focus, poor low light)
but perfectly usable for "does this plant look healthy / is it wilting / is the
reservoir low." A C920 (1080p, ~$50 est.) is a middle ground with better optics.

### Two cameras
- **Pi 5** has **two native CSI connectors** — run two Camera Module 3s directly.
  Caveat: they run as **separate processes** (Picamera2/libcamera), with **no
  hardware frame sync** between them. For plant snapshots that's irrelevant; you
  just grab a frame from each. Note the Pi 5 uses the **smaller 22-pin
  high-density** connector, so a standard Module 3 needs the included adapter
  cable.
- **Pi 4 / Zero 2 W** have **one** CSI port. Second camera = either a **USB
  webcam** (easiest) or an **Arducam CSI multiplexer** HAT (adds cost/complexity).
- **Simplest two-camera path overall:** one CSI camera + one USB webcam on any
  board. Mix-and-match, no multiplexer, long USB run for the second angle.

**Recommendation:** 1× **Camera Module 3 Wide** as primary. If you want a second
view, add a second Module 3 (Pi 5) or a USB webcam (any board).

Sources:
[Camera Module 3 product page](https://www.raspberrypi.com/products/camera-module-3/) ·
[Camera Module 3 from $15 (sensor assemblies)](https://www.raspberrypi.com/news/available-now-from-15-raspberry-pi-camera-module-3-sensor-assemblies/) ·
[Dual cameras on Pi 5 (Tom's Hardware)](https://www.tomshardware.com/raspberry-pi/how-to-use-dual-cameras-on-the-raspberry-pi-5) ·
[Two camera modules on Pi 5 (The Pi Hut)](https://thepihut.com/blogs/raspberry-pi-tutorials/how-to-use-two-camera-modules-with-raspberry-pi-5) ·
[Logitech C270 (SparkFun)](https://www.sparkfun.com/logitech-c270-webcam-usb-2-0.html)

---

## 3. Switching the mains-powered LED grow light (SAFETY-CRITICAL)

This is the one place where getting it wrong can start a fire or electrocute you.
Read this section carefully.

### Option A — Wi-Fi smart plug + `python-kasa` (RECOMMENDED for a non-electrician)

Put the grow light on a **Kasa or Tapo smart plug** and control it from the Pi
over your LAN with the **`python-kasa`** library (Kasa devices) — no phone app,
no cloud, no internet dependency once set up. Tapo devices are also supported
(via the same project's Tapo/SMART support).

- **Safety:** the plug is a **sealed, UL-listed consumer appliance**. All mains
  wiring is inside a certified enclosure. You never touch or wire 120V yourself.
  This is by far the safest option.
- **Wiring effort:** essentially zero — plug light into plug, plug into wall.
- **Price:** **Kasa EP25 ~$15** (energy monitoring), **Tapo P125M** similar. Often
  cheaper in 2-packs.
- **Cost of switching a second load** (e.g. a mains water pump): just add another
  ~$15 plug.
- **Downside:** depends on Wi-Fi; ~1–2s latency; the plug's own relay is the wear
  item (fine for a few switches/day on a light schedule).

```python
# sketch: control a Kasa plug from the Pi
import asyncio
from kasa import Discover
async def set_light(on: bool):
    dev = await Discover.discover_single("192.168.1.50")  # plug IP
    await dev.turn_on() if on else await dev.turn_off()
```

### Option B — 5V relay module board (SunFounder / ELEGOO 2- or 4-channel)

A relay HAT/board lets the Pi's 3.3V GPIO switch a mechanical relay whose
contacts break the mains line.

- **Price:** **~$7–10** for a 2- or 4-channel opto-isolated board — cheapest option
  on paper.
- **BUT you must cut into a mains cable and wire live 120V to screw terminals.**
  For a non-electrician this is the risky path: exposed mains on a breadboard-area
  board, no enclosure, and cheap relay boards' isolation/creepage is often
  marginal. If you do this you **must**: use a properly rated relay, fully enclose
  it, strain-relief the cable, never run mains near the low-voltage side, and
  ideally have someone qualified check it.
- **When it makes sense:** you're comfortable with mains wiring and want local,
  network-independent control, or you're switching **low-voltage** loads (see §4)
  where there's no shock/fire hazard.

### Verdict
**Use a smart plug (Option A) for the mains grow light.** The ~$8 you'd save with
a bare relay board is not worth wiring live mains by hand. Reserve relay/MOSFET
boards for the **low-voltage** side (pumps, fans), where they're both cheap and
safe.

Sources:
[python-kasa (GitHub)](https://github.com/python-kasa/python-kasa) ·
[python-kasa docs](https://python-kasa.readthedocs.io/) ·
[Kasa EP25 (energy monitoring plug)](https://www.kasasmart.com/us/products/smart-plugs/kasa-smart-plug-slim-energy-monitoring-ep25) ·
[Tapo P100 (predates Matter, note newer P125M)](https://www.tp-link.com/us/home-networking/smart-plug/tapo-p100/) ·
[SunFounder 4-ch relay](https://www.sunfounder.com/products/4channel-relay-shield) ·
[ELEGOO 4-ch relay (Amazon)](https://www.amazon.com/ELEGOO-Channel-Optocoupler-Compatible-Raspberry/dp/B09ZQS2JRD)

---

## 4. Low-voltage switching: pumps (5–12V)

No mains here — this is safe DIY territory. Two jobs: (a) main circulation/top-up
pump, (b) optional nutrient **dosing** pump.

### Switching element: MOSFET board vs relay
- **MOSFET module (recommended for pumps):** logic-level MOSFET board (e.g. IRLZ44N
  or an "IRF520 MOSFET module", ~$3–6). Silent, no moving parts, **PWM-capable**
  (you can throttle pump speed), low heat. Pi GPIO → module signal pin, pump on
  the switched 12V rail.
- **Relay module:** works too, gives full isolation, but it's mechanical (clicks,
  wears) and can't PWM. Fine for simple on/off.
- **CRITICAL for either: a flyback (freewheeling) diode across the pump.** A pump
  motor is inductive; when you switch it off the collapsing field produces a
  voltage spike that can damage the MOSFET or feed back toward the Pi. Put a diode
  (e.g. 1N4148 for small pumps, 1N400x for bigger) across the motor, **cathode to
  +12V**. Many MOSFET modules include one, but verify. Also run the pump from a
  **separate 12V supply**, sharing only ground with the Pi — don't power a motor
  off the Pi's 5V rail.

### Pump options & prices

| Pump | Type | Voltage | Use | Price |
|---|---|---|---|---|
| Small USB submersible pump | Centrifugal | 5V USB | Circulation / top-up, low head | **~$8–12** |
| Generic 12V submersible (e.g. Gikfun) | Centrifugal | 12V | Circulation, more head/flow | **~$12–23** |
| Gikfun peristaltic dosing head | Peristaltic | 12V | Precise nutrient dosing (~0–100 ml/min) | **~$12–15** |
| Kamoer NKP low-flow peristaltic | Peristaltic | 12V | Better dosing accuracy/longevity | **~$25–40 (est.)** |
| AC Infinity 2-outlet dosing pump | Peristaltic (2ch) | 12V | Turnkey 2-nutrient dosing, 10-level | **~$60–90 (est.)** |

**Why peristaltic for dosing:** it moves a known volume per revolution, so you can
dose "X ml of nutrient A" by running it for a measured time — ideal for automated
nutrient/pH dosing. For plain water circulation, a cheap 5V/12V submersible is
fine.

**Recommendation:** a **5V or 12V submersible pump (~$10–20)** for circulation/
top-up switched by a **MOSFET module (~$5) with a flyback diode**, on a **12V
supply**. Add a **12V peristaltic dosing pump (~$12–15)** later only if you want
automated nutrient dosing.

Sources:
[Kamoer NKP 12V peristaltic (Amazon)](https://www.amazon.com/Kamoer-Peristaltic-Hydroponics-Nutrient-Analytical/dp/B07GWJ78FN) ·
[Gikfun peristaltic dosing head (Amazon)](https://www.amazon.com/Gikfun-Dosing-Peristaltic-Connector-Submersible/dp/B0B1M64VK9) ·
[AC Infinity dosing pump](https://acinfinity.com/peristaltic-pump-two-outlet-dosing-kit-for-hydroponics-10-level-control-210-ml-min/) ·
[MOSFET vs relay + flyback diode (Pi Forums)](https://forums.raspberrypi.com/viewtopic.php?t=342956)

---

## 5. Sensors (optional tier)

The camera already does a lot: it can visually confirm plant health, water level
(if the reservoir is visible), and growth. Sensors are a **second tier** — add the
cheap high-value ones, skip the finicky ones unless you're optimizing hard.

| Sensor | Measures | Interface to Pi | Price | Worth it? |
|---|---|---|---|---|
| **Float switch** | Water level (low/OK) | GPIO digital (1 pin) | **~$3–6** | **Yes** — dead simple, reliable, prevents dry-running the pump |
| **XKC-Y25** non-contact level | Water level, through tank wall | GPIO digital (needs 5V; **level-shift to 3.3V**) | **~$8–12** | Good — no hole in the tank, but pricier than a float |
| Ultrasonic (HC-SR04 / JSN-SR04T) | Continuous level/distance | GPIO (needs voltage divider on ECHO) | **~$4–10** | Optional — continuous reading, fiddlier |
| **SHT31** | Temp + humidity (accurate) | **I²C**, 3.3V native | **~$10–15** | **Yes** — best value environmental sensor; humidity matters for herbs & mold |
| DHT22 | Temp + humidity | 1-wire GPIO | **~$8–10** | OK — cheaper but slower/less accurate/flakier than SHT31 |
| TDS/EC sensor (e.g. DFRobot Gravity) | Nutrient concentration | **Analog → needs ADC** (Pi has no ADC; add ADS1115 ~$5) | **~$12–20 + ADC** | Only if seriously tuning nutrients; needs calibration & temp comp |
| pH sensor | Nutrient pH | Analog → ADC | **~$25–45** | Skip unless advanced; drifts, needs frequent calibration |
| Light sensor (BH1750/TSL2591) | Lux / PAR-ish | I²C | **~$5–10** | Nice-to-have; you already control the light schedule |

### Notes that bite people
- **The Pi has no analog input.** Any analog sensor (TDS/EC, pH, analog light)
  needs an **ADS1115 ADC (~$5, I²C)**. Digital/I²C sensors (SHT31, BH1750) connect
  directly.
- **3.3V logic:** the Pi's GPIO is 3.3V and **not** 5V-tolerant. Sensors that
  output 5V (XKC-Y25, HC-SR04 ECHO) need a **level shifter or voltage divider** or
  you can damage the Pi.

**Recommendation (value order):** (1) **float switch** for low-water protection
(~$5), (2) **SHT31** temp/humidity (~$12). That's the sweet spot. Add water-level
XKC-Y25/ultrasonic and a light sensor if you want; **defer TDS/EC and pH** unless
nutrient tuning becomes a goal — they need calibration and add real cost/hassle.

Sources:
[XKC-Y25 non-contact level (DFRobot wiki)](https://wiki.dfrobot.com/Non-contact_Liquid_Level_Sensor_XKC-Y25-T12V_SKU__SEN0204) ·
[XKC-Y25 (Amazon)](https://www.amazon.com/XKC-Y25-Capacitive-Non-Contact-Detection-XKC-Y25-NPN/dp/B0F3TM38F1)

---

## 6. Misc / glue parts

| Item | What for | Price (est.) |
|---|---|---|
| Jumper wires (M-F, M-M, F-F assortment) | GPIO ↔ sensors/modules | **~$6** |
| Half-size breadboard | Prototyping without soldering | **~$5** |
| GPIO screw-terminal HAT (or a proto-HAT) | Cleaner, more permanent wiring than a breadboard | **~$10–15** |
| 12V DC power supply (2–3A, barrel jack) | Powers pumps / MOSFET rail | **~$10–12** |
| DC barrel jack adapter / terminal | Connect the 12V PSU | **~$3** |
| Hookup wire (22AWG) | Pump/sensor runs | **~$8** |
| Enclosure / project box (electronics) | Keep the Pi + boards out of humidity/splashes | **~$12–20** |
| Optional: USB extension cable | Long run for a USB webcam | **~$6** |

**Humidity note:** a grow area is humid. Keep the Pi and any bare boards in a
**closed enclosure**, ideally outside the tent/cabinet, with only cables (camera
ribbon/USB, sensor leads) running in. Conformal-coat or bag exposed boards if
they must sit in the humid zone.

---

## Bill of materials — three build tiers

### Good / budget (single camera, camera-first)
| Item | Price |
|---|---|
| Pi Zero 2 W | $15 |
| PSU + 32GB SD + case | ~$23 |
| Camera Module 3 Wide (+ mini-CSI adapter) | ~$37 |
| Kasa/Tapo smart plug (grow light) | $15 |
| 12V submersible pump + MOSFET module + diode + 12V PSU | ~$30 |
| Float switch + jumpers/breadboard | ~$12 |
| Enclosure + misc wire | ~$25 |
| **Subtotal** | **~$170** |

### Better / recommended (Pi 5, room to grow, one great camera)
| Item | Price |
|---|---|
| Pi 5 (4GB) | $75 |
| Official 27W PSU + 32GB SD + case w/ cooler | ~$32 |
| Camera Module 3 Wide | ~$35 |
| Kasa/Tapo smart plug (grow light) | $15 |
| 12V submersible/circulation pump + MOSFET module + flyback diode | ~$20 |
| 12V PSU (2–3A) + barrel adapter | ~$14 |
| Float switch + SHT31 temp/humidity | ~$18 |
| Jumpers, breadboard/screw HAT, wire | ~$20 |
| Enclosure + misc | ~$18 |
| **Subtotal** | **~$247** |
| *(or buy the Pi via a CanaKit kit ~$130 and swap the first three rows)* | |

### Better+ / two cameras + dosing (add-ons to the "Better" build)
| Add-on | Price |
|---|---|
| Second Camera Module 3 (or USB webcam) | ~$25–35 |
| 12V peristaltic dosing pump | ~$12–15 |
| Second smart plug (e.g. mains pump/fan) | ~$15 |
| XKC-Y25 non-contact level + level shifter | ~$14 |
| Light sensor (BH1750) | ~$8 |
| **Add-on subtotal** | **~$75–90** |

---

## Safety summary (read before buying)

1. **Do not hand-wire mains (120V).** Switch the grow light with a **UL-listed
   smart plug** controlled via `python-kasa`. This removes essentially all
   electrical risk from the build.
2. If you *insist* on a mains relay board, it must be fully **enclosed**, properly
   rated, strain-relieved, and kept away from the low-voltage side — and ideally
   inspected by someone qualified.
3. **Never run a motor/pump off the Pi's 5V rail.** Use a **separate 12V supply**,
   common ground only, and a **flyback diode** across every pump/motor/relay coil.
4. **Pi GPIO is 3.3V and not 5V-tolerant.** Level-shift any 5V sensor output
   (XKC-Y25, ultrasonic ECHO).
5. **Water + electricity + humidity:** enclose the electronics, keep them above/
   outside the reservoir, and use drip loops on all cables.
