# samogrow — Shopping List

Copy-paste-ready order list for **five buildable variants** (full rationale in
`spec/SPEC.md` §4). Three of them share one unit: order the **V1 cart** below, then add
the **+ V2** and **+ V3** deltas in place — additive, zero waste. **V4** is an independent
retrofit-kit unit; **V5** is the on-device Pi electronics that relocate the brain. The
V1–V3 brain runs on a machine you already own — **no controller, no soldering, no wiring**
until you get to V5.

**Recommendation (to try several for real):** order the **V1 cart when you're ready to
start** (transplant grown herbs for a same-day garden, or sow seeds for the cheaper slower
path) and the **V4 unit at the same time** (earlier if it's the premium Auk V4b — its
**100-day money-back clock starts at purchase**, so order early to overlap a full grow
cycle), so both units germinate in parallel and you get an A/B from week one. Then buy the
**+ V2** ($25) and **+ V3** ($55) deltas as you go (each is a small parts add + a config
line). Decide on **V5** after ~a month of laptop-brain experience. Full superset cart +
grand total at the bottom.

> **Note on the +V2 delta:** the V1 default is the **KP125M energy-monitoring
> 2-pack** — one plug runs the light, the second is the exact plug the V2 pump
> needs, so the V2 plug then costs **$0**. That makes the +V2 delta just **~$25**
> (pump + tubing + jug); the plug cost is already paid at V1.

Prices are USD, mid-2026; those marked **(est.)** are market-typical estimates from the
research files — verify at the source before buying (expect ±30% from coupons/sellers).

---

## Tools you'll need (one-time, NOT counted in any total below)

Assembly tools — the first few most people already own; the two in **bold** are the
likely buys. None of these are in the variant totals.

| Tool | Est. price | Note |
|---|---:|---|
| Power drill | owned / ~$40 | cuts the lid holes; any cordless drill works |
| **3" (76 mm) hole saw** | ~$13 if not owned | [Acekit 3"/76 mm bi-metal](https://www.amazon.com/dp/B07JJ65D25) — sizes the net-cup holes exactly (a step bit can't reach 3") |
| Scissors / utility knife | owned | cut tubing, open packaging |
| Measuring cup | owned | pump calibration (SPEC §8) + mixing nutrient solution |
| **Small digital gram scale (0.1 g)** | ~$11 if not owned | [AWS-600, 600 g × 0.1 g](https://www.amazon.com/dp/B002SC3LLS) — weigh the MasterBlend / CaNO₃ / Epsom parts; kitchen scales don't resolve grams |
| Step drill bit (optional) | ~$12 | only if you drill the tote wall for a push-fit sight-gauge grommet (§9a); the zero-drill gauge needs none |

---

## V1 — Manual start (Kratky-style) · the default cart · ~$232

*(= Tier A in the SPEC BOM tables.)* The AI reads the camera (and the sight gauge, if you
add V3) and **tells you** on Telegram when and roughly how much to pour. No pump, no
vacation autonomy — away >1 week needs a human.

### Network appliances ("electronics")

| # | Photo | Qty | Item | Est. price | Where / note |
|---|---|---|---|---:|---|
| 1 | <img src="../docs/img/components/kasa-smart-plug.jpg" width="80"> | 1 | [Kasa **KP125M energy-monitoring 2-pack**](https://www.amazon.com/dp/B0BYGRLRS1) | $25 (est.) | **Recommended default.** UL-listed, local LAN control. One plug runs the light now; the second is exactly the energy-monitoring plug the V2 pump needs — so **the V2 plug (item 13) then costs $0**. Buying two singles later costs more. Only pick the [$8 EP10 single](https://www.amazon.com/dp/B091699Z3W) instead if you're certain you'll never automate watering (pure lifelong-Kratky) |
| 2 | <img src="../docs/img/components/tapo-camera.jpg" width="80"> | 1 | [TP-Link **Tapo C100, 1080p** Wi-Fi camera (RTSP)](https://www.amazon.com/dp/B0866S3D82) | $18 (est.) | **Select the C100 (1080p) model** — it does local RTSP, which is all our software needs. [tp-link.com](https://www.tp-link.com/us/home-networking/cloud-camera/tapo-c100/). The [C120 (2K)](https://www.amazon.com/dp/B0CH45HPZT) is a fine pricier alt (~$25) but the C100 is sufficient |

**Appliance subtotal: ~$43** (2-pack $25 + camera $18; the EP10-single floor is ~$26)

### Grow side

| # | Photo | Qty | Item | Est. price | Where / note |
|---|---|---|---|---:|---|
| 3 | <img src="../docs/img/components/storage-tote.jpg" width="80"> | 1 | [Opaque black food-safe tote, **7 gal (~23" L)** (HDX black)](https://www.homedepot.com/p/HDX-7-Gal-Tough-Storage-Tote-in-Black-with-Yellow-Lid-999-7G-HDX/328027039) | $12 (est.) | **Select the 7 gal / ~23" long size** — must be opaque (algae) and ~23" so the 2 ft light spans it; drill 3" holes |
| 4 | <img src="../docs/img/components/net-pots.jpg" width="80"> | 1 | [**3 inch** net pots, **25-pack** (VIVOSUN)](https://www.amazon.com/dp/B07VQVCRWV) | $13 (est.) | select 3" diameter, 25-count |
| 5 | <img src="../docs/img/components/rockwool-plugs.jpg" width="80"> | 1 | [Grodan A-OK **1.5 inch** rockwool plugs, **50-pack**](https://www.amazon.com/dp/B071S1DHDQ) | $12 (est.) | select 1.5" plugs, 50-count |
| 6 | <img src="../docs/img/components/clay-pebbles.jpg" width="80"> | 1 | [Hydroton / LECA clay pebbles, **10 liter** bag (made in Germany)](https://www.amazon.com/dp/B01KYYZ9DE) | $20 (est.) | select the 10 L bag; rinse first; reusable |
| 7 | <img src="../docs/img/components/air-pump.jpg" width="80"> | 1 | [Uniclife **dual-outlet** air pump — select the **"10–100 Gallon" style**](https://www.amazon.com/dp/B01EBXI7PG) | $15 (est.) | **This bundle already includes the airline tubing + 2 air stones + 2 check valves** — so there's no separate air-stone or airline line to buy. Runs 24/7 on a **dumb** outlet — never a switched plug. *Pure-Kratky lettuce-only: skip item 7 (−~$15)* |
| 8 | <img src="../docs/img/components/masterblend-nutrients.jpg" width="80"> | 1 | [MasterBlend 4-18-38 Combo Kit, **2.5 lb**](https://www.amazon.com/dp/B071L15G5Y) | $25 (est.) | **Select the 2.5 lb kit** (1 lb MasterBlend 4-18-38 + 1 lb Calcium Nitrate 15.5-0-0 + 0.5 lb Epsom salt) — makes ~180 gal, >1 yr for one tote. The 5 lb kit is only worth it for multiple beds. Mix all 3 parts |
| 9 | <img src="../docs/img/components/ph-control-kit.jpg" width="80"> | 1 | [GH pH Control Kit — **8 oz pH Up + 8 oz pH Down + indicator**](https://www.amazon.com/dp/B000BNKWZY) | $22 (est.) | select the 8 oz Up/Down combo with indicator; target pH 5.5–6.5 |
| 10 | <img src="../docs/img/components/barrina-light-strips.jpg" width="80"> | 1 | [Barrina T5 — **White (full-spectrum), 2 ft, 4-pack**](https://www.amazon.com/dp/B0BKPF8D8G) | $42 (est.) | **Pick WHITE** (the pinkish/yellow-tinted versions are weaker for growth); select **2 ft** to match the ~23" tote. The white-vs-black *cover* choice is cosmetic housing only. ~20 W/strip, linkable, adjustable height |
| 11 | <img src="../docs/img/components/seed-packets.jpg" width="80"> | 1 | **Plants (default): 2–4 potted herbs in 3–4" nursery pots (~$5 each)** — or [seed packets: Sow Right 5-herb collection](https://www.amazon.com/dp/B07CTMVKT9) | $15 (est.) | **Default: buy 2–4 grown herb plants in 3–4" nursery pots** (~$5 each) for a same-day garden (see the Fastest-start note below). Seeds are the slower alt: [Sow Right 5-herb](https://www.amazon.com/dp/B07CTMVKT9) + a [loose-leaf lettuce packet](https://www.amazon.com/dp/B0BJZ9L9B3). **Mint from neither** — root a live grocery cutting (free / ~$3); it won't come true from seed |
| 12 |  | 1 | [EC/TDS meter — handheld pen, **0.0–9990 ppm range**](https://www.amazon.com/dp/B000VTQM70) | $13 (est.) | **required** — the spec sets an EC target (1.0–1.6 mS/cm ≈ 700–1100 ppm); you can't hit it without a meter. Select a 0–9990 ppm handheld pen (TDS-3 class) |

**Grow-side subtotal: ~$189** (the air-pump kit at item 7 already bundles the tubing + air stones + check valves, so there are no separate air-stone or airline lines). *Pure-Kratky lettuce-only: drop item 7 → ~$174.*

> **Fastest start (default): transplant grown herbs, skip germination.** Instead of waiting
> ~2–4 weeks for seeds (item 11) to sprout, buy **2–4 grown herb plants — basil, parsley — in
> 3–4" nursery pots from a garden center (~$5 each)**, wash **all** the soil off the roots, and
> set the root balls straight into the net cups: a full, working garden the same day (SPEC §5).
> This is a **roughly price-neutral, either/or substitute for the seed packets, not an add-on** —
> so item 11 is counted once either way. Seeds (item 11) stay as the cheaper, slower option for
> growing from scratch.

### V1 total: **~$232** (appliance ~$43 + grow ~$189 = $232). *Cheaper floor for someone who'll never automate:* swap the 2-pack for the **$8 EP10 single** → appliance ~$26, **V1 ~$215**; further drop the air-pump kit (item 7) for pure-Kratky lettuce-only → **~$200**.

### Mounting & power (small accessories, ~$15–25, NOT in the totals above)

The Barrina strips **daisy-chain and ship with hanging clips + link cables**, so the
light needs no separate fixture — hang the strips from their clips under a wire
shelf/rack you likely already have, or from two spring-tension rods (~$10). For the
camera, add any **¼"-screw ball-head clamp mount** (~$8–13) so the Tapo perches high over
the canopy (SPEC §5) — e.g. a [SUPON ball-head super-clamp](https://www.amazon.com/dp/B01JZ5Y1JQ);
these small photo clamps go in and out of stock, so any ¼"-thread clamp works. A **6-outlet
power strip** (~$10, most people own one) feeds the light plug, the air pump, and (at Tier B)
the pump plug. A $20–25 adjustable grow-light stand is the tidier alternative to the
improvised shelf.

---

## + V2 adds — Auto top-up · +~$25 → ~$256

*(= Tier B.)* Adds the pump so the software waters for you within hard timer caps.
Software switch is one config line (set `pump.plugHost`). This is the full "core" build.

| # | Photo | Qty | Item | Est. price | Where / note |
|---|---|---|---|---:|---|
| 13 | <img src="../docs/img/components/kasa-smart-plug.jpg" width="80"> | 1 | [2nd Kasa plug — energy-monitoring, for the pump](https://www.amazon.com/dp/B0BYGRLRS1) | **$0** (est.) | energy read = pump-health signal (SPEC §9a). **Already bought** — it's the second plug from the V1 default [KP125M 2-pack](https://www.amazon.com/dp/B0BYGRLRS1) (~$25 for two), so this line is **$0** here. Only if you took the EP10-single floor at V1 do you buy a plug now: the [KP115 energy-monitoring single](https://www.amazon.com/dp/B08LN3C7WK) (~$15). Also at [kasasmart.com](https://www.kasasmart.com/us/products/smart-plugs/kasa-smart-plug-slim-energy-monitoring-kp125m) |
| 14 | <img src="../docs/img/components/submersible-pump.jpg" width="80"> | 1 | [Small 120 V submersible fountain pump (DOMICA 90 GPH)](https://www.amazon.com/dp/B0892DKNR3) | $12 (est.) | switched by the pump plug; timed top-up |
| 15 |  | 1 | [Vinyl tubing for the pump feed — **3/8" ID, 10 ft**](https://www.amazon.com/dp/B07NQSNBTG) | $6 (est.) | jug → reservoir (this is the pump feed line, separate from the air-pump kit's airline) |
| 16 |  | 1 | [**1–2 gal** jug (plain-water top-up feed)](https://www.amazon.com/1-gallon-water-jug-spigot/s?k=1+gallon+water+jug+with+spigot) | $6 (est.) | bounds the worst-case flood (SPEC §9) |

**V2 adds: ~$25 → running total ~$256** (exact: $232 + $12 pump + $6 tubing + $6 jug = $256; the 2nd plug was already bought in the V1 2-pack, so it's $0 here)

---

## + V3 adds — Water safety pack · +~$55 → ~$311

*(= Tier C.)* Cheap, independent layers so the build isn't blind to the reservoir (full
rationale in `spec/SPEC.md` §9a); each catches a different water failure. Applies mainly
to V2 — but the **sight gauge is worth adding even at V1**, since it's what makes the AI's
water-level reading reliable. (Pump-health monitoring is already covered by the
energy-monitoring KP125M in V2 — it's software, $0 extra.)

| # | Photo | Qty | Item | Est. price | Where / note |
|---|---|---|---|---:|---|
| 17 |  | 1 | **Camera-readable sight gauge** — [clear vinyl tube **3/8" ID**](https://www.amazon.com/dp/B07NQSNBTG) + [rubber grommet / bulkhead fitting **for 3/8" tube**](https://www.amazon.com/s?k=rubber+grommet+bulkhead+fitting+3%2F8) + [bright float bead](https://www.amazon.com/s?k=bright+foam+fishing+float+beads) | $8 (est.) | route the tube up **into the camera's view**; AI reads the level off the bead. Zero-drill install in SPEC §9a. Can reuse an offcut of the Tier B tubing |
| 18 |  | 1 | [Govee Wi-Fi Water Sensor, **3-pack** (2.4 GHz, no hub)](https://www.amazon.com/Detector-Wireless-Notification-Security-Basement/dp/B07J9HZ5VN) | $35 (est.) | sits on the floor under the tote/pump; phone push + 100 dB alarm on any leak, independent of the brain |
| 19 |  | 1 | [Plastic boot/drip tray, **~20×15 in**](https://www.amazon.com/NINAMAR-Boot-Tray-Inch-Trays/dp/B07RL6BWTB) | $12 (est.) | passive containment under the whole tote; also gives the leak sensor a place to catch water |

**V3 adds: ~$55 → running total ~$311** (exact: $256 + $55 = $311)

---

## V4 — Retrofit a finished unit (independent A/B) · ~$85 (V4a) or ~$225 (V4b Auk)

A separate garden that reuses nothing from V1–V3. Buy a finished countertop unit, clip a
camera to it, run the samogrow brain in **observe-only** mode. Honest limits (SPEC §4g):
the AI observes, analyzes per-pot, and reminds you — but the unit's light/pump sit behind
its own integrated timer (one power cord), there's no auto top-up (small reservoir, manual
refills), and no upgrade path. Two flavors:

**V4a — budget kit (~$85):**

| # | Qty | Item | Est. price | Where / note |
|---|---|---|---:|---|
| V4a-1 | 1 | [iDOO ID-IG301 12-pod kit](https://www.amazon.com/iDOO-Hydroponics-Germination-Adjustable-ID-IG301/dp/B08DLMRKHM) | $60 (est.) | integrated LED, fan, pump, knob timer; $50–70 for this class ([LetPot LPH-Lite](https://www.amazon.com/LPH-Lite-Hydroponics-Growing-Controlled-Automatic/dp/B0F8RCYF6W) ~$120 is a Wi-Fi step-up) |
| V4a-2 | 1 | [TP-Link **Tapo C100, 1080p** camera (RTSP)](https://www.amazon.com/dp/B0866S3D82) | $18 (est.) | clip it to view the pods; [C120 (2K)](https://www.amazon.com/dp/B0CH45HPZT) is the pricier alt |
| V4a-3 | 1 | [Kasa smart plug, EP10 single (optional)](https://www.amazon.com/dp/B091699Z3W) | $8 (est.) | crude on/off of the *whole* kit only |

**V4a total: ~$85–95** (own seeds reused from the V1 packets).

**V4b — premium Auk (~$225):** the [**Auk Mini 2**](https://www.auk.com/products/auk-mini-2)
— the Scandinavian wood/cream design-icon that inspired this project — retrofitted with our
camera + AI. Its **100-day money-back guarantee makes the A/B risk-free**: run it ~3 months
next to the DIY unit, keep whichever wins, return the Auk otherwise. Order it **early** so
the 100-day clock covers a full grow cycle. **No pods, no subscription** — plant your own
seeds in coco-fibre (open consumables, like the DIY unit); only limit is its 4-pot capacity.

| # | Qty | Item | Est. price | Where / note |
|---|---|---|---:|---|
| V4b-1 | 1 | [Auk Mini 2](https://www.auk.com/products/auk-mini-2) | $199 | on sale from $229, free shipping; 4 coco-fibre pots, 24 W LED, app lighting + holiday mode |
| V4b-2 | 1 | [TP-Link **Tapo C100, 1080p** camera (RTSP)](https://www.amazon.com/dp/B0866S3D82) | $18 (est.) | clip it to view the pots; [C120 (2K)](https://www.amazon.com/dp/B0CH45HPZT) is the pricier alt |
| V4b-3 | 1 | [Kasa smart plug, EP10 single (optional)](https://www.amazon.com/dp/B091699Z3W) | $8 (est.) | crude on/off of the *whole* unit only |

**V4b total: ~$225** (own seeds reused from the V1 packets).

---

## V5 — On-device Pi controller (+~$135, reuses V2/V3 garden)

Relocates the brain onto a Raspberry Pi with a hard-wired float-switch interlock and a
CSI camera. **Reuses all of V2/V3's garden hardware except the Tapo camera** (the Pi uses
the CSI module instead). No new grow parts — just the electronics below (SPEC §4h, §12).

| # | Qty | Item | Est. price | Where / note |
|---|---|---|---:|---|
| V5-1 | 1 | Raspberry Pi 5 (4GB) | $75 (est.) | native dual-CSI; **Pi Zero 2 W (~$15)** is the budget board |
| V5-2 | 1 | Official 27 W USB-C power supply | $12 (est.) | Pi 5 wants 27 W for full USB power |
| V5-3 | 1 | microSD 32 GB (A2) | $9 (est.) | or boot from USB/NVMe |
| V5-4 | 1 | Pi Camera Module 3 Wide (120°, 12 MP, CSI) | $35 (est.) | replaces the Tapo; sharper leaves |
| V5-5 | 1 | Float switch + jumper wires | $6 (est.) | GPIO reads low/OK — the true hardware flood interlock |

**V5 marginal add: ~$135** (Pi Zero 2 W path ≈ ~$75). *Optional low-voltage pump path:*
12 V pump (~$15) + MOSFET module w/ flyback (~$5) + 12 V supply (~$12) if you want the Pi
to drive the pump directly instead of via the Kasa plug (+~$30).

---

## TOTALS AT A GLANCE

| Variant | Cost | Notes |
|---|---:|---|
| **V1 — Manual start** (default) | **~$232** | EP10-single floor ~$215; pure-Kratky lettuce-only ~$200 |
| **+ V2 — Auto top-up** | **~$256** | +$25 in place (2nd plug already in the V1 2-pack) |
| **+ V3 — Water safety** | **~$311** | +$55 in place |
| **V4a — Retrofit, budget kit** | **~$85** | independent unit; cheapest A/B control |
| **V4b — Retrofit, premium Auk** | **~$225** | design-icon unit; 100-day money-back = risk-free A/B |
| **+ V5 — On-device Pi** | **+~$135** | reuses V2/V3 garden minus the Tapo |
| **SUPERSET — all five, in hand** | **~$530 / ~$670** | budget (V4a) / premium Auk (V4b); = V3 $311 + V4 + V5 $135 |

Optional further add-ons (see `spec/SPEC.md` §4e): second Tapo C100 camera (~$18), timed
dosing pump + plug (~$25), digital pH pen (~$15). Ongoing consumables run **~$35/yr** per
unit; Claude API runs **~$3–7/mo** for one or both units.

**Order-day reminder:** the fast start is to **transplant grown herbs** — pick up 2–4 potted
basil/parsley plants when you order, and you have a working garden the day the parts arrive
(wash all soil off the roots first — SPEC §5). Growing from seed instead? Start parsley the
moment seeds arrive — germination takes 10–28 days — and soak 12–24 h before sowing.
