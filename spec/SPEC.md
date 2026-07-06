# samogrow by Nombox — Build Spec

**Version:** v1.4.3
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
  $29–39/mo Kelby AI membership (~$408/yr)** — 3-year TCO **>$2,100**
  ($899 + $408×3 = $2,123).
- Lettuce Grow: $200–400/yr consumables.

The AI-camera tier is exactly the feature people pay the most for, and only Gardyn
ships it. A Wi-Fi camera + a laptop-side Claude Haiku vision service delivers the
same capability (plant-health checks, watering/lighting decisions, harvest nudges)
for **~$3–7/month in API calls and no subscription fees**, on **open, commodity
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
   growing continuously so there's always something to cut — not a single harvest. He'd
   rather not wait weeks for germination before it even looks like a garden, so the default
   start is transplanting grown herbs; from seed is the cheaper, slower option for the patient.
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
one nutrient batch — the simplest thing for the AI to monitor. The top-up pump is the
one part that is **optional at first**: **Tier A** runs this exact DWC reservoir but
tops up **by hand** when the AI says to (manual-watering mode); **Tier B** adds the pump
so the software does it. See §4.0 for the variants.

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

**The centerpiece is that the electronics side is trivial** — one or two smart plugs,
a Wi-Fi camera, and (optionally) a pump — landing at ~$50 for the recommended KP125M
2-pack + camera (or ~$33 with the EP10 single if you'll never automate), or ~$68 once
the pump and tubing are added (the 2-pack already covers both plugs), with the bulk of
the cost in the grow side (which you'd pay on any hydroponic system) and the light.

### 4.0 Choose your variant — five you can actually build

There are **five concrete, buildable variants.** Three of them (V1→V3) are the same DIY
unit growing up in place — each upgrade is parts you plug in plus one or two config
lines, never a rebuild. **V4** is an independent retrofit unit that runs in parallel.
**V5** relocates the brain onto an on-device Raspberry Pi and is the only variant that
teaches real embedded electronics. The BOM tables map cleanly: **V1 = Tier A**,
**V2 = Tier B** (V1 + pump), **V3 = Tier B + Tier C** (V2 + water-safety pack); V4 (in two
flavors, budget **V4a** and premium **V4b**) is §4g, V5 is §4h.

| Variant | Est. cost | Assembly effort | AI control surface | Vacation autonomy | Flood risk | What it uniquely teaches |
|---|---:|---|---|---|---|---|
| **V1 — Manual / Kratky** | **~$255** | low — plumbing + 2-pack plug + camera | AI observes per-pot, **tells you** when/how much to pour (Telegram) | **none** — away >1 wk needs a human | ~none (no pump) | how far camera-only vision gets you; Kratky baseline |
| **V2 — Auto top-up** | **~$280** | + drop in a pump, tubing, jug (2nd plug already in the V1 2-pack) | above **+ waters for you** within hard timer caps | ~2 wks (bounded jug) | low — bounded by jug + caps | closed-loop actuation over Wi-Fi; software timer-cap safety |
| **V3 — Auto + water safety** | **~$335** | + sight gauge, leak sensor, boot tray | above + **reads reservoir level** off the gauge; escaped-water alerts | ~2 wks, monitored | low + contained + alarmed | layered sensing — making camera water-decisions trustworthy |
| **V4a — Retrofit, budget kit** (§4g) | **~$95** | lowest — no build; unbox a cheap kit + clip on a camera | AI observes + analyzes + **reminds only**; can't drive the kit's light/pump | none — small tank, hand refills | kit's own ~4–6 L tank | AI as an overlay on a sealed appliance; cheapest A/B control |
| **V4b — Retrofit, premium Auk** (§4g) | **~$235** | lowest — unbox the Auk + clip on a camera | same observe-only overlay as V4a | none — 4-pot unit, hand refills | Auk's own reservoir | the design-icon unit as the A/B partner; **100-day money-back = risk-free trial** |
| **V5 — On-device Pi controller** (§4h) | **+~$135** (reuses V2/V3 garden) | high — GPIO wiring, MOSFET, SD-card reliability | above **+ a true hard-wired float-switch interlock** and a sharper CSI camera | ~2 wks, **hardware-gated** | lowest — hardware interlock, not just timers | real embedded build: GPIO, MOSFET/flyback, float switch, on-device 24/7 |

**Recommendation (for actually trying several):**

1. **Start V1 the day the parts arrive — transplant a grown herb, don't wait to germinate.**
   Buy 2–4 healthy potted herbs (basil, parsley) from a garden center (~$4–5 each), wash
   **all** the soil off the roots, and set each root ball into a net cup of clay pebbles —
   a full, good-looking, working garden the **same day**. (Growing from seed is the cheaper,
   slower alternative: ~2–4 weeks of germination first, parsley slowest at 10–28 days.)
   Either way the manual "pour when the AI says" loop costs nothing and gets the camera +
   Claude running immediately.
2. **Order the V4 unit at the same time (earlier if it's the premium Auk, V4b).** Its
   plants should be germinating in parallel so you get a real A/B from week one — and the
   **Auk's 100-day money-back window starts ticking at purchase**, so order it early to
   overlap the trial clock with the whole DIY grow cycle (germinate → grow → first harvest
   is ~6–10 weeks; you want the 100 days to cover it before the return deadline).
3. **Upgrade V1 → V2 → V3 in place as parts arrive** — additive on the *same* hardware,
   one purchase path, zero waste (V2 = set `pump.plugHost`; V3 = add the safety pack).
4. **Decide on V5 after ~a month** of laptop-brain experience, once you know whether you
   want the hardware float interlock and CSI camera enough to take on soldering + SD
   reliability.

### 4.0a Trying several for real — order, sharing, and the superset cart

The five variants are **not five separate purchases.** They share hardware deliberately:

- **V1 → V2 → V3 are strictly additive on one unit.** You buy the V1 cart, then only the
  V2 delta (~$25), then only the V3 delta (~$55). Nothing is thrown away and nothing is
  bought twice — the V1 default is the KP125M **2-pack**, so V2's pump plug is already
  in hand ($0), and the pump you add at V2 stays through V3 and V5.
- **V4 is an independent parallel unit** — pick one flavor. It is a sealed appliance, so
  it **reuses nothing** from the DIY line and the DIY line reuses nothing from it; its only
  extra consumable is its own seeds. **V4a** (budget iDOO-class kit, ~$95) is the cheapest
  A/B control; **V4b** (the premium Auk, ~$235) is the design-icon unit whose **100-day
  money-back guarantee makes the whole A/B risk-free** — keep whichever earns its counter
  space, return the Auk if the DIY wins.
- **V5 replaces the laptop-brain with a Pi and reuses ALL of V2/V3's garden hardware**
  (tote, light, pumps, plugs, nutrient, safety pack) **except the Tapo camera**, which
  the Pi swaps for a CSI Camera Module 3. Its marginal cost is just the Pi + CSI camera +
  float switch (~$135).

**Superset shopping cart — run the whole program:**

| Step | Adds | Marginal cost | Cumulative |
|---|---|---:|---:|
| **V1** | base DIY unit, manual watering (KP125M 2-pack covers both plugs) | $255 | **$255** |
| **+ V2** | pump + tubing + jug (2nd plug already in the V1 2-pack) | +$25 | **$280** |
| **+ V3** | sight gauge + leak sensor + boot tray | +$55 | **$335** |
| **+ V4** | independent retrofit unit + camera + plug + own seeds | **+$95 (V4a)** / **+$235 (V4b Auk)** | **$430 / $570** |
| **+ V5** | Pi 5 + CSI Camera Module 3 + float switch + wiring (relocate brain) | +$135 | **~$565 / ~$705** |
| | **Grand total — all five, in hand** | | **~$565 (budget) / ~$705 (premium Auk)** |

Choosing the premium Auk over the budget kit for V4 adds **~$140** to the program
(~$235 vs ~$95) — the difference between a throwaway control and a keeper you'd actually
want on the counter (offset, if the DIY wins, by the Auk's 100-day refund).

**What can't be shared:** V4's integrated unit (its own light, pump, tank, timer) overlaps
nothing with the DIY unit — you are genuinely buying a second garden. Everything else
compounds: the grand total is the *whole* program, versus ~$335 — just the DIY unit at
V3 — if you skipped both the retrofit A/B (V4) and the Pi (V5).

### 4.0b Running two units as an A/B

With the DIY unit (V1/V2/V3) and the retrofit kit (V4) side by side, **one brain watches
both** — the vision loop already takes a list of cameras (`cameras.devices` is an array),
so you point one camera at each unit and the same Claude prompt returns a per-pot health
verdict for each. Because both grow the same varieties from the same seed stock, you get
two comparable time series: germination speed, days-to-first-harvest, canopy fill, and
any deficiency or algae events, all logged from the same model on the same cadence. The
weekly deep review (Sonnet, §7) can then compare units directly — "DIY basil is ahead of
the kit's by ~4 days; the kit's cilantro bolted first" — turning the two builds into an
actual experiment instead of two anecdotes. The only asymmetry to keep in mind: on V4 the
AI only *observes* (the kit's timer runs the light/pump), so differences partly reflect
the kit's fixed schedule versus the AI-tuned DIY schedule — which is itself one of the
things worth measuring.

### 4a. Network appliances / "electronics"

| Part | Suggested product | Est. price | Tier | Source |
|---|---|---:|:--:|---|
| Light + pump switching | Kasa **KP125M energy-monitoring 2-pack** (default) | **$25** (est.) | A | UL-listed, local LAN control; one plug runs the light now, the second is the V2 pump plug — so the pump plug is $0 later. EP10 single (**$8**) is the never-automate floor |
| Camera | TP-Link Tapo C110 / C120 (Wi-Fi, RTSP) | **$25** (est.) | A | supports local RTSP snapshots |
| Pump switching | *(already bought — 2nd plug from the V1 2-pack)* | **$0** | **B** | energy read = pump-health signal (§9a); only the EP10-single floor needs a KP115 single (~$15) here |
| Top-up pump | Small 120 V submersible fountain pump | **$12** (est.) | **B** | switched by the pump plug |
| Pump tubing | Vinyl tubing for the top-up feed | **$6** (est.) | **B** | jug → reservoir |
| | **Tier A appliance subtotal** | **~$50** | | 2-pack + camera (EP10-single floor: ~$33) |
| | **Tier B appliance add** | **+~$18** | | pump + tubing (2nd plug already in the 2-pack) |

No microcontroller, no PSU beyond the pump's own plug, no MOSFET, no float switch,
no breadboard, no enclosure, no jumper wire. Nothing to solder. In **Tier A** the default
2-pack gives you two plugs (one runs the light, the second waits for the pump) plus one
camera; at **Tier B** only the pump itself and its tubing arrive — the plug is already in
hand. (The EP10-single floor buys just the one light plug at Tier A and adds a pump plug
at Tier B.)

### 4b. Grow side

| Part | Suggested product | Est. price | Tier | Source |
|---|---|---:|:--:|---|
| Reservoir | Opaque food-safe tote, ~5–7 gal | **$12** (est.) | A | must be opaque (algae); drill 3" holes |
| Net cups | 3" net pots, 25-pack | **$13** (est.) | A | Amazon |
| Starter plugs | Grodan A-OK 1.5" rockwool, 50 ct | **$12** (est.) | A | Amazon |
| Grow media | Hydroton / LECA clay pebbles, ~10 L | **$20** (est.) | A | reusable, rinse first |
| Air pump | Adjustable aquarium air pump, dual outlet | **$15** (est.) | A* | runs 24/7, low power, always on |
| Air stone | Air stone / disc diffuser, 2-pack | **$8** (est.) | A* | Amazon |
| Airline | Silicone airline 25 ft + check valve | **$7** (est.) | A* | check valve stops back-siphon |
| Nutrient | MasterBlend 4-18-38 Combo Kit, 2.5 lb | **$28** (est.) | A | makes ~180 gal — outlasts the build |
| pH | GH pH Control Kit (Up/Down + indicator) | **$22** (est.) | A | target pH 5.5–6.5 |
| Grow light | Barrina T5 2 ft full-spectrum strips, 4-pack | **$40** (est.) | A | ~20 W/strip, linkable, adjustable height |
| Seeds | Parsley + basil + cilantro + lettuce packets (+ live mint cutting) | **$15** (est.) | A | Sow Right / Botanical Interests; mint from a grocery cutting, not seed |
| EC/TDS meter | HM Digital TDS-3 class handheld pen | **$13** (est.) | A | **required** — the EC target below can't be hit without it |
| Top-up jug | 1–2 gal jug for plain-water feed | **$6** (est.) | **B** | feeds the pump; bounds worst-case flood (see §9) |
| | **Tier A grow-side subtotal** | **~$205** | | |
| | **Tier B grow-side add** | **+~$6** | | top-up jug |

**A\*** — the air pump / stone / airline (~$30) is **recommended** and included in the
Tier A total: continuous-harvest herbs (basil, parsley, mint) want oxygen at the roots
the whole time. **Pure-Kratky sub-option:** a **lettuce-only** grower can skip the air
pump, stone, and airline entirely and let the falling water level leave an air gap —
true passive Kratky — dropping **~$30 more** (Tier A → **~$210**). Don't do this if you
want herbs; do it only for a single crop of leafy greens.

The air pump (when used) is powered continuously on its own wall plug or a dumb
always-on outlet — DWC needs oxygen 24/7, so it is deliberately **not** on a switched
plug.

### 4c. Tier totals

| Tier | What it adds | Appliance | Grow side | **Tier total** |
|---|---|---:|---:|---:|
| **A — Manual start** | 2-pack (light + spare) + camera; manual pour on AI's cue | ~$50 | ~$205 | **~$255** |
| ↳ EP10-single floor (never automate) | swap the 2-pack for the $8 single | ~$33 | ~$205 | **~$238** |
| ↳ pure-Kratky (lettuce only) | EP10 single **and** drop air pump/stone/airline | ~$33 | ~$175 | **~$210** |
| **B — + Auto top-up** | pump + tubing + jug (2nd plug already in the 2-pack) | +~$18 | +~$6 | **~$280** |
| **C — + Water safety** (§4d) | sight gauge + leak sensor + boot tray | — | — | **+~$55** |

These three rows are variants **V1 / V2 / V3** (§4.0). Tier B (V2) is the current full
"core" build (~$280); Tier C added (V3) is ~$335 all-in. The two other variants are the
**V4 retrofit unit** (§4g — budget V4a ~$95 or premium Auk V4b ~$235) and the **V5
on-device Pi controller** (§4h, +~$135 on V2/V3). The superset cart to run all five is in
§4.0a (~$565 budget / ~$705 with the premium Auk).

### 4d. Tier C — Water safety pack (+~$55–60)

Cheap, independent layers so the build isn't blind to the reservoir (full rationale in
§9a). **Applies mainly to Tier B** (once a pump can actually move water), but the sight
gauge is worth adding **even at Tier A** — it is what makes the AI's water-level reading
reliable instead of a guess.

| Add-on | Product | Est. price |
|---|---|---:|
| Sight gauge (level) | Clear vinyl tube + grommet + float bead, in camera view | **$8** (est.) |
| Leak sensor (escaped water) | Wi-Fi water sensor, e.g. Govee (phone push + alarm) | **$35** (est.) |
| Boot/drip tray (containment) | Shallow tray under the whole tote | **$12** (est.) |
| | **Tier C subtotal** | **~$55–60** |

### 4e. Nice to have (further upgrades)

| Add-on | Product | Est. price |
|---|---|---:|
| Second camera angle | 2nd Tapo Wi-Fi camera (RTSP) | **$25** (est.) |
| Nutrient dosing | Kasa plug + small dosing pump (timed) | **$25** (est.) |
| Air-pump monitoring | Extra energy-monitoring plug (air-pump health) | **$13** (est.) |
| pH precision | Digital pH pen | **$15** (est.) |
| | **Nice-to-have delta** | **~$78** |

### 4f. Yearly consumables

Almost everything is a one-time kit that lasts many grows:

| Consumable | Notes | Est. $/yr |
|---|---|---:|
| Nutrient (MasterBlend) | 2.5 lb kit makes ~180 gal — years of supply | ~$0 (amortized) |
| Rockwool plugs | ~$12/50 ct; 1–2 refills/yr | ~$15 |
| Seeds | new packets / varieties | ~$15 |
| pH Up/Down refills | occasional | ~$8 |
| **Total ongoing** | | **~$35/yr** |

### 4g. Variant V4 — retrofit a finished unit (two flavors)

The lowest-effort variant and the **A/B control unit**: buy a finished countertop garden,
clip a camera onto it, and run the same samogrow brain in **observe-only** mode. Two
flavors depending on whether V4 is a throwaway control or a keeper you'd want on the
counter.

**V4a — budget kit (~$95).** A cheap 10–12-pod kit is plenty for a control unit:

| Part | Suggested product | Est. price | Note |
|---|---|---:|---|
| Countertop kit | [iDOO ID-IG301 12-pod (~$60)](https://www.amazon.com/iDOO-Hydroponics-Germination-Adjustable-ID-IG301/dp/B08DLMRKHM) | **$60** (est.) | integrated LED, fan, pump, knob timer; ~$50–70 for this class ([LetPot LPH-Lite](https://www.amazon.com/LPH-Lite-Hydroponics-Growing-Controlled-Automatic/dp/B0F8RCYF6W) ~$120 is a Wi-Fi step-up) |
| Camera | TP-Link Tapo C110 / C120 (RTSP) | **$25** (est.) | clip it to view the pods |
| Smart plug (optional) | 1× Kasa plug (EP10 single) | **$8** (est.) | only crude on/off of the *whole* kit |
| | **V4a total** | **~$85–100** | own seeds reused from the V1 packets |

**V4b — premium Auk (~$235).** The [**Auk Mini 2**](https://www.auk.com/products/auk-mini-2)
is the Scandinavian wood-and-cream smart garden that **inspired this whole project** — a
design object you actually *want* on the counter, not a plastic tray. Retrofitting it with
our camera + AI turns the inspiration into the A/B partner:

| Part | Suggested product | Est. price | Note |
|---|---|---:|---|
| Smart garden | [Auk Mini 2](https://www.auk.com/products/auk-mini-2) | **$199** | on sale from $229, free shipping; 4 coco-fibre pots, 24 W LED, app lighting + holiday mode |
| Camera | TP-Link Tapo C110 / C120 (RTSP) | **$25** (est.) | clip it to view the pots |
| Smart plug (optional) | 1× Kasa plug (EP10 single) | **$8** (est.) | only crude on/off of the *whole* unit |
| | **V4b total** | **~$225–240** | own seeds reused from the V1 packets |

**Why the Auk is the risk-free A/B:** it ships with a **100-day money-back guarantee.**
Run it next to the DIY build for ~3 months — the AI monitors both (§4.0b) — and keep
whichever earns its counter space; if the DIY unit wins, send the Auk back and recover its
cost entirely. Order it **early** so the 100-day clock covers a full germinate-to-harvest
cycle (§4.0a).

**Auk consumable economics (good news, per `research/01-commercial-analogs.md`):** unlike
Click & Grow, the Auk has **no proprietary pods and no subscription** — you plant **your
own seeds** in coco-fibre pots, so it runs on the same open, commodity seed the DIY unit
does. The only recurring cost is cheap coco-fibre pot refills; a fair A/B on consumables,
not a rigged razor-and-blades unit. (Its one real limit as a test bed is **capacity — just
4 pots**, versus the DIY unit's ~6 and a 12-pod kit, so it's a smaller sample.)

**What the AI *can* do on either V4a or V4b:** pull the camera snapshot, analyze plant
health per-pot, call out a struggling seedling, read the water window if visible, and push
daily reports + reminders to Telegram ("top up the tank", "harvest the basil"). It is a
real, useful AI-gardener overlay — the same vision loop as V1–V3.

**What it *cannot* do (be honest — true of both flavors, Auk included):**
- **No real light/pump control.** The unit's LED and pump run off one power cord behind an
  **integrated timer** (the Auk's app schedules its own light; V4a kits often **lose their
  settings on a power cycle**). A smart plug can only cut power to the *whole unit*, so
  smart-plug switching fights the firmware rather than controlling it. The AI observes and
  advises; the unit's own timer decides.
- **No auto top-up.** Small reservoir; you refill by hand. Nothing for the brain to
  actuate.
- **No upgrade path, no sharing.** Sealed appliance — no sight gauge, no leak pack, no
  reservoir plumbing, and it reuses nothing from (and lends nothing to) the DIY line. To
  get real AI control you move to V1/V2, not extend this.

**Position:** lowest effort, **least AI control**, and the clean parallel unit for the A/B
(§4.0b) — V4a when it's just a cheap control, V4b when you want a keeper and a risk-free
trial. Choose V1 instead if you want the AI to actually *run* the light and (with V2) the
water.

### 4h. Variant V5 — on-device Raspberry Pi controller (+~$135)

The only variant that teaches real embedded electronics. It **relocates the brain** from
the laptop onto a Pi sitting with the garden, and in doing so gains the one thing the
all-Wi-Fi build can't have: a **hard-wired float switch** the software reads on GPIO as a
true flood interlock (not just a timer cap), plus a sharper 12 MP CSI camera. It **reuses
all of V2/V3's garden hardware** (tote, light, pumps, plugs, nutrient, safety pack) —
only the Tapo camera is set aside in favor of the CSI module. Full rationale and the
deeper trade-offs are in the appendix (§12); this is the buildable mini-BOM.

| Part | Suggested product | Est. price | Note |
|---|---|---:|---|
| Controller | Raspberry Pi 5 (4GB) | **$75** | native dual-CSI, current-gen; **Pi Zero 2 W (~$15)** is the budget board (single mini-CSI, fiddlier) |
| Power supply | Official 27 W USB-C PSU | **$12** | Pi 5 wants the 27 W for full USB power |
| Boot media | microSD 32 GB (A2) | **$9** | or boot from USB/NVMe |
| Camera | Pi Camera Module 3 Wide (120°, 12 MP, CSI) | **$35** | replaces the Tapo; frames the whole tray up close |
| Flood interlock | Float switch + jumper wires | **$6** | GPIO reads low/OK; software gates the pump on it in hardware |
| | **V5 marginal add (reuses V2/V3)** | **~$135** | Pi Zero 2 W path ≈ ~$75 |

Optional, only if you also want to drop mains switching for the pump: a **12 V
submersible/peristaltic pump (~$15) + MOSFET module with flyback diode (~$5) + a 12 V
supply (~$12)** lets the Pi drive the pump directly on low voltage instead of through the
Kasa plug (+~$30). Not required — V5 can keep switching the existing 120 V pump via the
Kasa plug over the LAN and simply *add* the float switch as the hardware gate.

**What it uniquely does:** a real hardware interlock (the float switch physically bounds
the worst case, §9), an on-device 24/7 brain that needs no separate always-on machine,
and the sharpest camera of any variant. **What it costs you:** GPIO wiring, a MOSFET +
flyback if you go low-voltage, SD-card reliability work (log2ram / overlay FS), and a
device to maintain — the exact complexity V1–V3 were designed to avoid. Take it only
after you know you want the interlock or the CSI camera.

### 4i. Cost comparison over 2 years

| System | Hardware | 2-yr subscription/consumables | AI? | 2-yr total |
|---|---:|---:|:--:|---:|
| **samogrow — V1 (manual)** | ~$255 | ~$70 consumables + ~$120 Claude API ($5/mo) | **Yes** | **~$445** |
| **samogrow — V2 (auto)** | ~$280 | ~$70 consumables + ~$120 Claude API ($5/mo) | **Yes** | **~$470** |
| Gardyn Home 4 | ~$899 | ~$816 (Kelby AI $34/mo) | Yes | **~$1,715** |
| Click & Grow SG9 | ~$200 | ~$400 (pods + sub) | No | **~$600** |
| Auk Mini 2 | ~$229 | ~$0 (bring your own seeds) | No (scheduling only) | **~$229** |

**The pop:** samogrow lands in the same one-time price bracket as the *no-AI*
countertop units (~$200–280) while delivering the camera+AI capability that
otherwise **only exists on the $899 Gardyn with a ~$408/yr subscription.** Starting at
**V1 that gap widens** — ~$445 all-in over two years, **roughly $1,270 cheaper than
Gardyn**, and *below the no-AI Click & Grow's* 2-year cost while adding AI monitoring,
more plants, and open consumables with no lock-in. Upgrading to V2's automation adds
just ~$25 (the pump plug was already bought in the V1 2-pack). The DIY "premium" over the
cheapest timer units is small; the AI-tier savings are enormous. (Running the whole
five-variant program is a one-time ~$565 of hardware — ~$705 if V4 is the premium Auk,
§4.0a — still under a single Gardyn.)

---

## 5. Assembly plan

![Field-guide illustration of the samogrow parts laid out — two full-spectrum T5 light strips above a DWC tote of basil, parsley, cilantro and lettuce in net cups, a top-up water jug with a small pump, a Wi-Fi camera, an air pump feeding an air stone, and two smart plugs on a power strip](../docs/img/build-illustration.jpg)

No soldering, no wiring. Assembly is plumbing + plugging in + network config. The plan
below builds **Tier B** (the full auto-top-up build); steps tagged **[Tier B]** are the
pump/jug parts — **skip them for a Tier A manual build** and you still have a complete,
AI-monitored garden that pings you when to pour. Adding them later is exactly these same
steps plus a two-line config change.

### Day 0 — order everything

Place your order (see `spec/SHOPPING-LIST.md`). The Kasa plug(s), the Tapo camera, and
(for Tier B) the pump are all standard consumer Wi-Fi gear.

### Day 1 — get your plants: transplant (default) or germinate (from scratch)

**Default — transplant a grown herb, running the same day.** You don't have to wait for
germination. Buy 2–4 healthy potted herbs (basil, parsley), build the reservoir (Day 2–4
below), then nest each plant's root ball in a 3" net cup packed with **LECA clay pebbles**
and lower it into the lid so the longest roots reach the solution — a full, good-looking
garden the same day. **Three things before you drop a plant in:**

1. **Wash ALL the soil off the roots** — lukewarm running water, teasing the ball apart
   gently. This is the one step you can't skip: soil left in a DWC reservoir rots, fouls the
   water, and clogs the pump.
2. **Expect a few days of droop** (transplant shock) as roots adapt to water culture — lower
   the light a bit and keep the air stone running; it recovers. Don't keep lifting the plants
   to check them.
3. **Buy a plant, not a bunch.** Get a potted herb *plant* from a nursery's seedling section
   (one plant in a 3–4" pot of soil), or search "live herb plant" online (e.g. Bonnie Plants).
   Avoid the produce-aisle "fresh/living herbs" packs sold for cooking — those are many weak
   seedlings crammed into one plug; usable only if you pull the clump apart into a few starts
   first.

**Alternative — grow from seed (cheaper, ~2–4 weeks slower).** Skip the plant purchase and
start seeds the moment they arrive, before building anything. Parsley is the bottleneck at
10–28 days.

1. **Soak parsley seeds** in warm water 12–24 h (change the water once) to leach out
   the coumarin germination inhibitors.
2. Rinse/pH-condition rockwool plugs. Sow soaked parsley + basil + cilantro +
   lettuce into separate plugs.
3. Keep plugs **~70 °F (21 °C) and constantly moist** — one dry-out kills germinating
   parsley. Basil sprouts in 5–7 days; parsley in 10–28. Transplant each sprout into a net
   cup (surround with LECA) once it has roots out of the plug and true leaves.
4. Use flat-leaf "Giant of Italy" parsley, Genovese basil, a slow-bolt cilantro
   (Calypso/Santo), and a loose-leaf lettuce.

For **mint**, either path uses a rooted cutting from a grocery bunch or a potted plant in
its own cup at one end — mint won't come true from seed.

### Day 2–4 — build the DWC reservoir

1. Drill six **3" (76 mm)** holes in the opaque tote lid for net cups — use a 3" hole
   saw (the net-cup rim seats on the 3" hole; see the tools list in `spec/SHOPPING-LIST.md`).
2. Rinse the LECA pebbles (dusty) and the rockwool.
3. Run airline from the (always-on) air pump → check valve → air stone in the
   bottom of the tote. Keep the air pump above the water line. (Skip for the
   pure-Kratky lettuce-only sub-option; keep it for herbs.)
4. **[Tier B]** Position the top-up jug **above** the reservoir; put the small pump in
   the jug and run its tubing into the tote. (Tier A: no pump — you top up by hand when
   the AI tells you to.)
5. **Mix nutrient with the gram scale.** The MasterBlend 4-18-38 combo kit is 3 parts;
   the standard full-strength recipe is **2.4 g MasterBlend + 2.4 g calcium nitrate +
   1.2 g Epsom salt per gallon** ([masterblend.com](https://www.masterblend.com/4-18-38-tomato-formula/),
   [PowerGrow](https://www.powergrowsystems.com/products/masterblend-4-18-38-fertilizer-master-kit-bulk)).
   Dissolve each part **fully and separately, in order — MasterBlend, then Epsom, then
   calcium nitrate last — never mixing the dry concentrates** (calcium reacting with the
   sulfate/phosphate locks out nutrients). For leafy herbs and lettuce run it mild, about
   **half strength**, and confirm with the EC/TDS meter: target **EC ~1.0–1.6 mS/cm
   (~700–1100 ppm)**. Adjust pH to 5.5–6.5 with the GH kit.

### Day 4–5 — light + camera + plugs

1. Mount the Barrina strips 15–30 cm above the canopy, spaced for even coverage,
   at **adjustable** height (avoid Click & Grow's fixed-height flaw). Plug the light
   into the **light Kasa plug**.
2. **[Tier B]** Plug the top-up pump into the **pump Kasa plug**. Plug the air pump into
   a normal, always-on outlet (never a switched plug — DWC needs oxygen 24/7). (Tier A
   has only the light plug; the air pump still goes on its own dumb outlet.)
3. Mount the Tapo camera HIGH — clamped to the light-frame upright at or just
   below the light bar, tilted ~30–45° down at the canopy — so every net cup
   (and the sight-gauge tube, if installed) is in frame. A counter-level,
   sideways view hides the far pots behind the near ones and can't see into
   the cups; the overhead angle is what the AI's per-pot analysis needs.
4. Onboard the Wi-Fi devices in their apps (Kasa app for the plug(s), Tapo app for the
   camera — two plugs at Tier B, one at Tier A). In the Tapo app, **create an RTSP
   camera account** (username + password) and note the RTSP URL. Set **DHCP
   reservations** on your router so the plug(s) and camera keep stable IPs.

### Day 5 — software on the always-on machine (Mac / mini-PC / VM)

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`.
2. Clone the repo, `cd software`, `bun install`. Also install **ffmpeg**
   (`brew install ffmpeg` on Mac) — it snapshots the RTSP camera; not needed in mock mode.
3. Create `.env` with `SAMOGROW_TELEGRAM_TOKEN`, `SAMOGROW_TELEGRAM_CHAT_ID`,
   `ANTHROPIC_API_KEY` (readable only by you). Get the bot token from **BotFather**. The
   bot does **not** message you first — get your chat id by messaging
   [@userinfobot](https://t.me/userinfobot), or send any message to your own bot and open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id` (mirrors
   `software/README.md`).
4. Create `config.json` with the light plug host (`light.plugHost`), the camera RTSP
   URL(s), and light schedule. **Tier A: leave `pump.plugHost` empty** — the brain then
   runs in **manual-watering mode**, sending a Telegram reminder with a suggested amount
   instead of switching a pump. **Tier B: set `pump.plugHost`** (plus pump calibration)
   and the same verdict auto-waters within the timer caps. That one field is the whole
   A→B software switch.
5. Run in **mock mode** first (`SAMOGROW_MOCK=1 bun run src/main.ts`) to validate
   the Claude call + Telegram push with no devices. Then run live.
6. Install as a background service: **launchd** on macOS (a `LaunchAgent` plist with
   `KeepAlive`) or **systemd** on a Linux VM (`Restart=always`). Keep the machine awake
   so the loop keeps running: on Mac, disable sleep in **System Settings → Battery /
   Energy Saver** (or run **`caffeinate -s`**, or use the **Amphetamine** app); on a
   Linux VM, disable suspend.
7. **Add the plants.** If you transplanted grown herbs (the default), they're already in
   their net cups — the garden is running from day one. Growing from seed instead? Move
   each sprout into a net cup (surround with LECA) as it develops roots — don't wait for
   the whole tray; basil is ready in ~1–2 weeks, parsley 10–28 days, and the slow ones
   catch up on their own schedule.

---

## 6. Device setup & network (replaces "wiring")

There is no wiring diagram because there is no wiring. The whole "electronics"
integration is network config:

| Device | Onboard in | Software needs | Stability |
|---|---|---|---|
| Light smart plug | Kasa app | `light.plugHost` (IP) | DHCP reservation |
| Pump smart plug **(Tier B)** | Kasa app | `pump.plugHost` (IP) | DHCP reservation |
| Wi-Fi camera | Tapo app | RTSP URL + camera account (user/pass) | DHCP reservation |
| Air pump | — (dumb outlet) | none — always on | always powered |

Notes:

- **Kasa control is local-LAN**, not cloud — the brain discovers/commands the plug(s)
  on your network. Set each plug to a **static/reserved IP** so `config.json`
  doesn't drift. (Tier A has just the light plug; the pump plug arrives with Tier B.)
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
   - *Watering (Tier B, auto):* if `pump.plugHost` is set and the verdict says water,
     turn the **pump plug** on for a bounded duration — never longer than
     `pump.maxSecondsPerRun` per run and never more than `pump.maxSecondsPerDay` total
     per day. `pump.mlPerSecond` converts seconds→volume. **These caps are the anti-flood
     backstop: the AI can request water, it cannot override the cap.** If the plug reports
     energy, read wattage to confirm the pump actually drew power (pump-health signal).
   - *Watering (Tier A, manual mode):* if `pump.plugHost` is **empty**, there is no pump
     to switch, so the same "water" verdict instead pushes a **Telegram reminder** —
     "reservoir looks low, pour ~X" (the suggested volume comes from `pump.mlPerSecond`
     × a nominal run, or the sight-gauge reading if present). The human is the actuator;
     the AI just decides when and roughly how much. It de-dupes so it doesn't nag every
     cycle.
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
| `pump.plugHost` | `192.168.1.51` (empty at Tier A) | Kasa plug IP for the top-up pump; **empty ⇒ manual-watering mode** (Telegram reminders, no auto-pump) |
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
each one misses. Layers 1–3 are the **Tier C — Water safety pack** (§4d, ~$55–60, see
`spec/SHOPPING-LIST.md`); layers 4–5 are already in the design (layer 4 needs the Tier B
energy-monitoring pump plug).

**Layer 1 — Camera-readable sight gauge (~$8, passive, no electronics).**
A short length of clear vinyl tube (3/8" ID) shows the true reservoir level by
communicating vessels. **Simplest install (zero-drill, recommended):** stand the tube
vertically *inside* the tote, clipped to the wall and open at the bottom so it fills to
the reservoir level, and route its top up through a small notch in the lid into frame —
nothing below the waterline to seal, so nothing to leak. (Prefer an external gauge?
Drill one hole low in the tote wall sized to a rubber grommet, push-fit the grommet, and
push the tube through it — the grommet alone seals it, no bulkhead fitting needed.) Drop
a brightly colored float bead in the tube and route the tube up **inside the camera's
field of view**. Now every photo the brain already
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

**Week 1 — order, get plants, software in mock mode.**
Place the Day-0 order and pick up 2–4 grown herb plants (the default fast start). In
parallel, on your always-on machine: `bun install`, get the bot from BotFather, run the
loop in `SAMOGROW_MOCK=1`, and verify the Claude vision call + JSON verdict + Telegram
push work end-to-end against a sample plant photo. (Growing from seed instead? Start
germination the moment seeds arrive — parsley first, it's slow — and expect ~2–4 extra
weeks before there's anything to transplant.)

**Week 2 — assemble and deploy.**
Build the DWC reservoir, mount the light and camera, onboard the two plugs and the
camera, set DHCP reservations and the RTSP account. Wire `config.json` to the plug
IPs and RTSP URL. Run the §8 device bring-up checklist. Install the service under
launchd/systemd. **Transplant the grown herbs** — wash all soil off the roots first — and
you have a full garden with first cuttings within days; from seed, transplant the sprouted
plugs instead and wait weeks for first harvest.

**Week 3+ — tune with real plants.**
Calibrate `mlPerSecond`, tune the photoperiod and analysis cadence, refine the
system prompt against real growth, and decide which nice-to-have upgrades (second
camera, dosing pump, energy monitoring) are worth adding.

---

## 12. Appendix — on-device controller (Raspberry Pi), the deep dive behind V5

This is the rationale behind **variant V5** (§4h has its buildable mini-BOM). The
all-Wi-Fi build (V1–V3) is still the recommended starting point; move the brain onto an
on-device Pi only for capabilities the network appliances can't provide:

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

- **v1.4.3 (2026-07-05)** — Made **transplanting a grown herb the default day-one path** —
  buy 2–4 potted herbs (basil, parsley), wash all soil off the roots, and set the root balls
  into net cups for a full working garden the same day — with **growing from seed reframed
  as the cheaper, ~2–4-week-slower alternative** (parsley slowest at 10–28 days). Updated the
  §4.0 recommendation, the §5 assembly plan (Day 1 now leads with the transplant route and
  keeps germination as the alternative; Day-5 step 7 rewritten), the §11 sprint plan (first
  harvest ~days for the transplant path vs weeks for seed), and the §2 user-story framing.
  Kept the honest caveats (soil in DWC rots/clogs — washing roots is non-negotiable; expect a
  few days of transplant shock; garden-center pots beat crammed grocery "living herb" clumps).
  No plug/price numbers changed — the grown plants (~$4–5 each) are a roughly price-neutral,
  either/or substitute for the seed line, not an addition to any total.
- **v1.4.2 (2026-07-05)** — Made the **KP125M energy-monitoring 2-pack (~$25)** the
  consistent V1 default across all three docs: one plug runs the light, the second is the
  V2 pump plug, so V2's plug is $0. V1 appliance subtotal ~$33 → **~$50** and V1 total
  ~$240 → **~$255**; the +V2 delta drops ~$45 → **~$25** (pump + tubing + jug only) with
  V2 ~$285 → **~$280** and V3 ~$340 → **~$335**. Kept the **EP10-single floor (~$238)** and
  the pure-Kratky lettuce-only (~$210) explicitly as the cheaper never-automate paths.
  Cascaded to the superset cart (~$570/$710 → **~$565/$705**), the §4a/§4c appliance +
  tier tables, and the §4i 2-yr TCO (V1 ~$430 → **~$445**, V2 ~$475 → **~$470**). No number
  moved by more than the plug cost shifting from V2 into V1.
- **v1.4.1 (2026-07-05)** — **QA fixes** across the spec, `SHOPPING-LIST.md`, and
  `docs/index.html`. Added the **EC/TDS meter** ($13) to the V1 grow side — it's
  required because the spec sets an EC target — and recomputed every affected total.
  Corrected the down-rounded V1 base ($33 appliance + $205 grow = **$238**, not the
  old "$220"), giving one honest cost frame everywhere: **V1 ~$240 · V2 ~$285 · V3
  ~$340** (superset **~$570 budget / ~$710 premium Auk**). Arithmetic fixes: Gardyn
  3-yr TCO corrected to **>$2,100** ($899 + $408×3); the §4.0a "skip V4+V5" figure
  fixed from ~$455 to **~$340** (that's just V3); the §4 electronics claim from "under
  ~$70" to **~$33 (light plug + camera) / ~$72 (with pump)**; "zero recurring fees" →
  **"no subscription fees"** (the API is recurring); 2-yr TCO rows to ~$430 (V1) / ~$475
  (V2). Fixed the **duplicate Kasa ASIN** — distinct pages for the EP10 single (light),
  the KP125M energy-monitoring 2-pack, and the KP115 single (pump). Added a **Tools
  you'll need** block (drill, 3"/76 mm hole saw, gram scale, etc.) and a **Mounting &
  power** note (camera clamp, power strip, light hanging) to the shopping list, both
  explicitly *not* in the build totals. Assembly plan: stated the **3" (76 mm)** hole-saw
  size; added the **MasterBlend recipe** (2.4 g MasterBlend + 2.4 g calcium nitrate +
  1.2 g Epsom per gallon, mixed separately in order) with the gram scale; fixed the
  **chat-id** instructions (bot doesn't message first — use @userinfobot or `getUpdates`,
  mirroring `software/README.md`); added **ffmpeg** install and an explicit **keep-awake**
  note; reworded the transplant step to move each species as it roots; and added a
  **zero-drill sight-gauge install** to §9a.
- **v1.4 (2026-07-05)** — Reframed around **five concrete, buildable variants** (the
  user intends to build and try up to five). §4.0 now presents **V1 Manual/Kratky
  (~$220), V2 Auto top-up (~$266), V3 Auto + water-safety (~$320), V4 Retrofit a finished
  unit, V5 On-device Pi controller (+~$135)** with a comparison table gaining a "what
  it uniquely teaches" column. Mapped V1/V2/V3 onto the existing additive Tier A/B/C
  tables (no table churn). Promoted the Pi appendix into **variant V5** with its own
  buildable mini-BOM (§4h: Pi 5 / Zero 2 W, Camera Module 3 Wide, float switch, optional
  MOSFET + 12 V pump). **V4 has two flavors:** **V4a budget** (iDOO-class ~$50–70 kit +
  camera + plug ≈ ~$95) and **V4b premium** — the **Auk Mini 2** ($199, was $229), the
  Scandinavian design-icon that inspired the project, retrofitted with our camera + AI;
  its **100-day money-back guarantee makes the A/B risk-free**, and (per
  `research/01-commercial-analogs.md`) it has **no pods and no subscription** — generic
  seeds in coco-fibre, cheap refills — with the one caveat of only 4 pots. V4b total
  ≈ ~$235. Added **§4.0a "Trying several for real"** (additive V1→V3 on one unit, V4 as an
  independent parallel unit ordered early for the Auk's 100-day window, V5 reusing all
  V2/V3 garden hardware except the Tapo camera) with a **superset shopping cart**
  (~$550 budget / ~$690 with the premium Auk; per-variant marginal cost + what can't be
  shared) and **§4.0b** A/B-evaluation notes (one brain, multiple cameras, comparable
  per-pot series, weekly deep-review comparison). Updated the recommendation to "start V1
  immediately, order V4 in parallel, upgrade V1→V2→V3 in place, decide V5 after ~a month."
  Superseded the "start with Tier A" framing and bumped section numbers (cost comparison →
  §4i).
- **v1.3 (2026-07-05)** — Restructured the BOM and assembly around **explicit,
  additive build variants**. Added §4.0 **Choose your variant** with a compact
  comparison table (cost / effort / AI control / vacation autonomy / flood risk) and a
  "start at Tier A" recommendation. **Tier A — Manual start (Kratky-style, ~$220):**
  drops the pump, pump plug, tubing, and top-up jug; the AI reads the camera (+ sight
  gauge) and tells you when/how much to pour over Telegram. Honest tradeoff: no vacation
  autonomy. Keeps the air pump for herbs; documented a pure-Kratky lettuce-only
  sub-option that drops it (−~$30 → ~$190). **Tier B — + Auto top-up (~$266):** the
  former "core" build; adds the pump parts and is a two-line config change
  (`pump.plugHost`). **Tier C — + Water safety pack (+~$55–60):** the existing sight
  gauge / leak sensor / boot tray tier, now §4d. **Alternative R — retrofit a dumb kit
  (§4g, ~$95):** buy an iDOO ID-IG301 12-pod kit + camera + optional plug; the AI
  observes/analyzes/reminds but can't drive the kit's integrated timer or auto-top-up —
  lowest effort, least control. Split the BOM tables by tier, marked pump steps in the
  assembly plan **[Tier B]**, updated tier totals and the 2-year cost comparison (Tier A
  ~$410 all-in), and documented the software **manual-watering mode** (`pump.plugHost`
  empty ⇒ Telegram reminders instead of auto-pump).
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
