# Hydroponics Grow-Side Parts Research

**Project:** AI-controlled indoor hydroponic herb garden (parsley, basil, cilantro, mint, lettuce)
**Buyer:** US, Amazon-first, USD
**Date:** July 2026
**Scope:** growing method, physical parts, LED lighting, seeds

> **Price note:** Amazon renders prices via JavaScript, so they are not reliably readable by automated fetch. Prices below are **market-typical July 2026 estimates** based on these product lines' historical Amazon pricing, and are marked *(est.)*. Verify at the linked product page before buying — expect ±30% swings from coupons/sellers. Product names and links are real listings.

---

## 1. Growing method recommendation

### TL;DR: Use **DWC (Deep Water Culture)** with an air pump, in a shared opaque tote, plus automated top-up.

For a countertop/shelf herb garden that runs continuously (parsley, basil, and mint are harvested for months, not once), DWC is the best balance of growth rate, simplicity, and fit with automated top-up + AI control.

### Method comparison for herbs on a countertop

| Method | How it works | Pros | Cons | Fit for this build |
|---|---|---|---|---|
| **Kratky** | Passive; roots dangle into a static reservoir, water level drops and leaves an air gap | Cheapest ($10–20), no pumps, no electricity, silent, zero moving parts | Falling water level is *the mechanism* — auto top-up defeats it; oxygen-starved for long-lived herbs; not built for continuous harvest | Poor fit — great for a single lettuce head, wrong for a months-long herb garden with top-up |
| **DWC (recommended)** | Roots sit in aerated nutrient solution; air pump + air stone oxygenate 24/7 | Fast growth, big yields, simple plumbing, one shared reservoir feeds many net cups, plays nicely with float valve / peristaltic top-up | Needs an air pump running (low power), reservoir must be opaque to block algae | **Best fit** — mint/basil love constant oxygenated water; easy to automate |
| **NFT** | Thin film of nutrient flows through channels, pumped continuously | Very efficient, excellent for leafy greens at scale | Pump must run constantly; pump failure = roots dry out in minutes; more plumbing, channels, slope | Overkill/fragile for a countertop; better for larger lettuce production |
| **Ebb & flow** | Timer pump floods a tray then drains | Good oxygenation, flexible | More parts (timer, pump, fill/drain fittings), more failure modes | More complexity than herbs need here |
| **Wick** | Passive capillary wick draws solution up | Dead simple, no power | Slow, can't keep up with thirsty/large herbs | Too weak for basil/parsley at size |

### Why DWC wins here
- **Continuous-harvest herbs need oxygen at the roots the whole time.** Kratky's air-gap trick works for a plant you harvest once (lettuce); it fights you on a mint plant you crop for six months. DWC's air stone gives constant dissolved oxygen regardless of water level.
- **Automated top-up is native to DWC.** In Kratky, topping up removes the oxygen gap the plant depends on. In DWC the level is *supposed* to stay high, so a float valve or peristaltic pump keeping it topped up is exactly right.
- **One reservoir, many plants.** A single opaque tote with 4–8 net-cup holes in the lid feeds all your herbs from one nutrient batch — simplest thing to monitor and dose for an AI controller.
- **Cheap and forgiving.** ~$30–50 of hardware over Kratky, far less fragile than NFT.

### Top-up automation: float valve vs peristaltic pump
- **Mechanical float valve (baseline, recommended):** ~$8–12. A mini float/ball valve mounted in the reservoir wall, fed by gravity from a raised top-up jug of plain water (or dilute nutrient). Zero electronics, self-regulating, fails safe. Best reliability-per-dollar.
- **Peristaltic dosing pump (AI-controlled option):** ~$15–25 bare 12V unit, or ~$60–80 for an [AC Infinity two-outlet dosing kit](https://acinfinity.com/peristaltic-pump-two-outlet-dosing-kit-for-hydroponics-10-level-control-210-ml-min/). Driven by a water-level sensor + microcontroller, this fits the "AI-controlled" theme and can also dose nutrients/pH. Anti-siphon, precise, won't overdose. Recommend this for the smart build; keep a float valve as a mechanical backstop.

**Suggested design:** opaque tote reservoir → 6 net cups in the lid → air pump + air stone for oxygen → float valve (baseline) *or* peristaltic pump + level sensor (AI version) fed from a plain-water top-up jug.

---

## 2. Parts list with prices

All estimates are Amazon US, July 2026. Buy the shared-reservoir DWC version.

### Core system

| Part | Suggested product | Est. price | Notes |
|---|---|---|---|
| **Reservoir** | Opaque food-safe tote, ~15–27 qt (e.g. Sterilite/HOMZ latching tote) or food-grade 5-gal bucket | **$10–15** *(est.)* | Must be **opaque** (black or wrapped) to stop algae. A shallow ~5–7 gal tote suits a 60×30 cm shelf. Drill 3" holes in the lid. |
| **Net cups, 3"** | [3" net pots, 25-pack](https://www.amazon.com/rockwool-cubes/s?k=rockwool+cubes) style listings | **$12–15** *(est.)* | 3" holds herbs well; 2" also fine for lettuce. Get more than you need — cheap. |
| **Starter plugs** | [Grodan A-OK 1.5" rockwool plugs](https://www.amazon.com/rockwool-starter-plugs/s?k=rockwool+starter+plugs) (50 ct) | **$10–18** *(est.)* | Rockwool is the standard. Rinse/pH-condition before use. Sponge/peat plugs (Rapid Rooter) are a tidier alternative at similar price. |
| **Grow media** | [Hydroton / LECA clay pebbles](https://www.amazon.com/clay-pebbles/s?k=clay+pebbles), ~10 L | **$18–25** *(est.)* | Fills the net cup around the plug. Rinse first (dusty). One bag lasts many grows and is reusable. |
| **Air pump** | Adjustable aquarium air pump, ~4–8 W, single/dual outlet | **$12–20** *(est.)* | Quiet, low power. Dual outlet lets you split to two stones. |
| **Air stone(s)** | Air stone / disc diffuser 2-pack | **$7–10** *(est.)* | One per reservoir is plenty at this size. |
| **Airline tubing** | Silicone/vinyl airline, 25 ft + check valve | **$6–8** *(est.)* | Check valve stops back-siphon into the pump. |
| **Top-up: float valve** | Mini float/ball valve for RO/hydro | **$8–12** *(est.)* | Baseline auto top-up. Gravity-fed from a raised jug. |
| **Top-up: peristaltic pump** *(AI option)* | 12V dosing peristaltic pump (bare) or [AC Infinity dosing kit](https://acinfinity.com/peristaltic-pump-two-outlet-dosing-kit-for-hydroponics-10-level-control-210-ml-min/) | **$15–25** bare / **$60–80** kit *(est.)* | Choose instead of (or alongside) the float valve for the smart build. |
| **Top-up reservoir** | 1–2 gal jug or small bucket | **$5–8** *(est.)* | Holds plain water for the top-up feed. |

### Nutrients

| Product | Est. price | Notes |
|---|---|---|
| [**MasterBlend 4-18-38 Combo Kit, 2.5 lb**](https://www.amazon.com/MASTERBLEND-4-18-38-Complete-Combo-Fertilizer/dp/B071L15G5Y) (incl. calcium nitrate + Epsom salt) | **$25–30** *(est.)* | **Recommended.** Best value dry nutrient; the 2.5 lb kit makes ~180–190 gallons — will outlast the build. Mix all 3 parts (never combine the concentrates undiluted). Cheapest cost-per-gallon. |
| [MasterBlend Combo Kit, 1.25 lb](https://www.amazon.com/MASTERBLEND-4-18-38-Complete-Combo-Kit/dp/B095LJHSQX) | **$14–18** *(est.)* | Smaller starter version if you'd rather not commit to 2.5 lb. |
| [General Hydroponics MaxiGro, 2.2 lb](https://www.amazon.com/General-Hydroponics-MaxiGro-Gardening-2-2-Pound/dp/B00NQANQAC) | **$20–25** *(est.)* | Single-part dry, one-scoop mixing — simplest for beginners; slightly pricier per gallon than MasterBlend. Great "just works" option for leafy greens. |
| [GH Flora Series trio (Gro/Micro/Bloom), 1 qt each](https://www.amazon.com/General-Hydroponics-Flora-FloraMicro-FloraBloom/dp/B09M942WYB) | **$40–50** *(est.)* | 3-part liquid, most tunable; easiest to auto-dose with peristaltic pumps (liquid). Overkill for herbs but ideal if the AI does the dosing. |

**Nutrient pick:** MasterBlend 4-18-38 combo for value; **MaxiGro** if you want the simplest single-part mixing; **Flora trio** if the AI will pump liquid nutrients automatically. Herbs/leafy greens run a mild solution (EC ~1.0–1.6 / ~700–1100 ppm).

### pH management

| Product | Est. price | Notes |
|---|---|---|
| [**GH pH Control Kit**](https://www.amazon.com/General-Hydroponics-pH-Control-Kit/dp/B000BNKWZY) (pH Up 8 oz + pH Down 8 oz + indicator + test tube) | **$20–25** *(est.)* | Everything to test and adjust. Target **pH 5.5–6.5** for herbs. |
| Digital pH pen (optional upgrade) | **$12–20** *(est.)* | More precise than drops; needs occasional calibration. Recommended if the AI logs pH. A [5-in-1 meter](https://www.spider-farmer.com/products/pre-order-spider-farmer-5-in-1-ph-hydroponic-meter-kit/) covers pH/EC/temp. |

### Rough grow-side subtotal

- **Baseline DWC (float-valve top-up), one-time hardware + first consumables:** **~$120–165** *(est.)*
  - reservoir $12 + net cups $13 + plugs $12 + pebbles $20 + air pump $15 + air stone $8 + tubing $7 + float valve $10 + top-up jug $6 + MasterBlend $28 + pH kit $22 ≈ **$153**
- **AI version (swap/add peristaltic pump + level sensor):** add **$15–70** depending on bare pump vs AC Infinity kit.
- Nutrients and plugs are consumables but the first kits last many grows, so ongoing cost is low.

---

## 3. LED grow light

### Recommendation: **Barrina T5 2 ft full-spectrum strips (best value)** or **Spider Farmer SF300 (tidiest single unit)**.

For a **60×30 cm (~2×1 ft, 0.18 m²) shelf** growing herbs at a target **100–200 µmol/m²/s PPFD**, you need only **~20–40 W** of efficient LED. Both options below clear that easily.

| Option | Specs | Est. price | Why |
|---|---|---|---|
| [**Barrina T5 2 ft strips, full spectrum**](https://www.amazon.com/Barrina-Lights-Indoor-Spectrum-Growing/dp/B0BKPF8D8G) (4-pack) | ~20 W per 2 ft strip, 5000K + full spectrum, linkable, plug-and-play | **$35–45** *(est.)* 4-pack | **Best value + best coverage.** Space 2–3 strips across the shelf for even light edge-to-edge; extras give flexibility. Linkable up to 16, on/off per strip. Easy to mount under a shelf. |
| [**Spider Farmer SF300**](https://www.amazon.com/2x2-5ft-Coverage-Spectrum-Hydroponics-Efficiency/dp/B08NWY5B4K) | 33 W, ~75 µmol/s output, 2.85 µmol/J, covers 2×2 ft, sunlike full spectrum | **$40–50** *(est.)* | **Tidiest single unit.** One panel covers the whole shelf, quiet, efficient, quality diodes (50k hr). Slightly less even than spread strips but simpler to hang. |
| Sansi / GE full-spectrum grow bulbs | 15–24 W each, screw into a clamp lamp | **$15–22** *(est.)* each | Cheapest entry, but point-source = uneven coverage over 60 cm; you'd need 2. Fine as a stopgap. |

**Lighting math:** 0.18 m² at ~150 PPFD needs roughly 27 µmol/s onto the canopy. An SF300 (75 µmol/s) or 2–3 Barrina 2 ft strips comfortably deliver that with margin for mounting distance. Run **14–16 h/day** on a timer (or AI schedule). Keep strips ~15–30 cm above the canopy; herbs tolerate fairly bright light, so err toward the higher PPFD for stocky, flavorful basil/parsley.

**Pick:** Barrina T5 2 ft 4-pack for even, cheap, flexible coverage across the shelf; SF300 if you prefer one clean panel.

---

## 4. Seeds

### Parsley — the slow one (plan around it)
- **Germination is genuinely slow: 10–28 days.** Seed coats contain coumarins/furanocoumarins that inhibit sprouting.
- **Speed it up:** soak seeds in warm water **12–24 h** before sowing (change the water once) to leach out inhibitors; keep the plug **~70°F (21°C)** and **constantly moist** — one dry-out can kill germinating parsley. Optionally pre-germinate on a damp paper towel and transfer sprouted seeds to plugs.
- **Varieties:** **Italian flat-leaf ("Giant of Italy")** — robust flavor, vigorous, best all-rounder for hydro. **Curly** parsley mainly for garnish. Hamburg parsley is grown for its root — skip for leaf harvest.

### Basil — the easy fast grower
- Germinates in **5–7 days**, thrives in DWC. **Genovese** is the classic pesto/culinary pick. **Dwarf/Greek ("Spicy Globe")** stays compact for a shelf. Pinch tops to keep bushy and delay flowering.

### Cilantro — succession-sow, bolt-resistant
- Bolts fast in heat/long days; sow small batches every 2–3 weeks. Choose **slow-bolt varieties: "Calypso" or "Santo."** Each "seed" is two seeds — you can gently crush to split for faster, denser germination.

### Lettuce — the DWC star
- Fast and forgiving in DWC. **Butterhead ("Rex," "Buttercrunch")** and **loose-leaf ("Black Seeded Simpson," Salanova / oakleaf types)** do great; harvest outer leaves for continuous cropping.

### Mint — use cuttings, not seed
- Mint seed is slow and unreliable; it grows aggressively from a rooted cutting dropped into a net cup. It will take over a shared reservoir, so give it its own cup at one end (or a separate small tote).

**Seed sourcing:** individual packets ~**$3–5** each (Sow Right Seeds, Botanical Interests, Burpee); a mixed culinary-herb pack runs ~**$10–15**. Budget **~$15** for parsley + basil + cilantro + lettuce packets; add a live mint plant/cutting rather than seed.

---

## Rough total (grow-side)

| Bucket | Est. cost |
|---|---|
| DWC hardware + reservoir + media + air | ~$70–85 |
| Nutrients + pH kit | ~$45–55 |
| Auto top-up (float valve baseline) | ~$15 |
| — *AI upgrade: peristaltic + sensor* | *+$15–70* |
| LED light | ~$40 |
| Seeds | ~$15 |
| **Total (baseline build)** | **~$185–210** *(est.)* |
| **Total (AI-automated top-up/dosing)** | **~$200–280** *(est.)* |

---

## Sources
- [Best Hydroponic Systems for Lettuce: NFT, DWC, Kratky](https://currentgardening.com/best-hydroponic-systems-lettuce/)
- [DWC vs Kratky for Apartments](https://urbanhydrospace.com/dwc-vs-kratky-apartments-beginners/)
- [DWC vs NFT vs Kratky: Cost, Yield & Best Pick — Truleaf](https://truleaf.org/insights/dwc-vs-nft-vs-kratky)
- [3 Best Countertop Hydroponic Systems 2026 — Urban Hydrospace](https://urbanhydrospace.com/the-3-best-countertop-hydroponic-systems-for-apartment-beginners-2026/)
- [MasterBlend 4-18-38 Combo Kit — Amazon](https://www.amazon.com/MASTERBLEND-4-18-38-Complete-Combo-Fertilizer/dp/B071L15G5Y)
- [MasterBlend 1.25 lb Combo — Amazon](https://www.amazon.com/MASTERBLEND-4-18-38-Complete-Combo-Kit/dp/B095LJHSQX)
- [GH MaxiGro 2.2 lb — Amazon](https://www.amazon.com/General-Hydroponics-MaxiGro-Gardening-2-2-Pound/dp/B00NQANQAC)
- [GH Flora Series trio — Amazon](https://www.amazon.com/General-Hydroponics-Flora-FloraMicro-FloraBloom/dp/B09M942WYB)
- [GH pH Control Kit — Amazon](https://www.amazon.com/General-Hydroponics-pH-Control-Kit/dp/B000BNKWZY)
- [Barrina T5 2 ft grow lights — Amazon](https://www.amazon.com/Barrina-Lights-Indoor-Spectrum-Growing/dp/B0BKPF8D8G)
- [Spider Farmer SF300 — Amazon](https://www.amazon.com/2x2-5ft-Coverage-Spectrum-Hydroponics-Efficiency/dp/B08NWY5B4K) · [SF300 product page](https://www.spider-farmer.com/products/spider-farmer-sf300-led-grow-light/)
- [AC Infinity peristaltic dosing pump](https://acinfinity.com/peristaltic-pump-two-outlet-dosing-kit-for-hydroponics-10-level-control-210-ml-min/)
- [Growing Hydroponic Parsley — IGWorks](https://igworks.com/blogs/growing-guides/growing-hydroponic-parsley)
- [Best Conditions for Hydroponic Parsley — Upstart University](https://university.upstartfarmers.com/blog/growing-hydroponic-parsley)
- [7 Tips for Growing Parsley from Seed — GrowVeg](https://www.growveg.com/guides/7-tips-for-growing-parsley-from-seed/)
