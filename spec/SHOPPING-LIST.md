# samogrow — Shopping List (Core Build)

Flat, copy-paste-ready order list for the **core build** (a complete working
AI garden). Prices are USD, mid-2026; those marked **(est.)** are market-typical
estimates from the research files — verify at the source before buying (expect
±30% from coupons/sellers). Full rationale is in `spec/SPEC.md` §4.

> **Buy the Pi and camera from an authorized reseller** (PiShop.us, CanaKit,
> Adafruit, The Pi Hut); check **rpilocator.com** for live stock/price. A CanaKit
> Pi 5 starter kit (~$130) bundles the board + 27 W PSU + SD + active-cooler case
> and replaces rows 1–4.

## Electronics / controller

| # | Qty | Item | Est. price | Where / note |
|---|---|---|---:|---|
| 1 | 1 | Raspberry Pi 5 (4GB) | $75 | PiShop.us / CanaKit |
| 2 | 1 | Official Raspberry Pi 27 W USB-C PSU | $12 | authorized reseller |
| 3 | 1 | 32 GB A2 microSD card | $9 (est.) | any |
| 4 | 1 | Pi 5 case with active cooler | $12 (est.) | The Pi Hut / CanaKit |
| 5 | 1 | Pi Camera Module 3 **Wide** (120°) | $35 (est.) | authorized reseller |
| 6 | 1 | Pi 5 camera cable (22-pin ↔ 15-pin) | $5 (est.) | Pi 5 uses the mini CSI connector |
| 7 | 1 | Kasa EP25 smart plug (UL-listed) | $15 | kasasmart.com — cheaper in 2-packs |
| 8 | 1 | 12 V submersible pump (top-up) | $12 (est.) | e.g. Gikfun 12 V |
| 9 | 1 | Logic-level MOSFET module (IRLZ44N / IRF520) | $5 (est.) | confirm it includes a flyback diode |
| 10 | 1 | 12 V 2–3 A DC PSU + barrel-jack adapter | $14 (est.) | separate rail for the pump |
| 11 | 1 | Float switch (GPIO digital) | $6 (est.) | low-water protection |
| 12 | 1 | Jumper wires + half-size breadboard | $11 (est.) | M-F / M-M / F-F assortment |
| 13 | 1 | 22 AWG hookup wire | $8 (est.) | pump/sensor runs |
| 14 | 1 | Electronics project box / enclosure | $15 (est.) | keep the Pi out of the humid zone |

**Electronics subtotal: ~$234**

## Grow side

| # | Qty | Item | Est. price | Where / note |
|---|---|---|---:|---|
| 15 | 1 | Opaque food-safe tote, ~5–7 gal | $12 (est.) | must be opaque (algae); drill 3" holes |
| 16 | 1 | 3" net pots, 25-pack | $13 (est.) | Amazon |
| 17 | 1 | Grodan A-OK 1.5" rockwool plugs, 50 ct | $12 (est.) | Amazon |
| 18 | 1 | Hydroton / LECA clay pebbles, ~10 L | $20 (est.) | rinse first; reusable |
| 19 | 1 | Adjustable aquarium air pump, dual outlet | $15 (est.) | quiet, low power |
| 20 | 1 | Air stone / disc diffuser, 2-pack | $8 (est.) | Amazon |
| 21 | 1 | Silicone airline 25 ft + check valve | $7 (est.) | check valve stops back-siphon |
| 22 | 1 | 1–2 gal jug (plain-water top-up feed) | $6 (est.) | Amazon |
| 23 | 1 | MasterBlend 4-18-38 Combo Kit, 2.5 lb | $28 (est.) | makes ~180 gal; mix all 3 parts |
| 24 | 1 | GH pH Control Kit (Up/Down + indicator) | $22 (est.) | target pH 5.5–6.5 |
| 25 | 1 | Barrina T5 2 ft full-spectrum strips, 4-pack | $40 (est.) | ~20 W/strip, linkable, adjustable height |
| 26 | 1 | Seed packets: flat-leaf parsley, Genovese basil, slow-bolt cilantro, loose-leaf lettuce | $15 (est.) | Sow Right / Botanical Interests; add a live mint cutting |

**Grow-side subtotal: ~$198**

---

## TOTAL (core build): **~$432**

Optional day-1 add-ons (see `spec/SPEC.md` §4d): SHT31 temp/humidity (~$12),
second camera (~$30), peristaltic dosing pump (~$13). Ongoing consumables run
**~$35/yr**; Claude API runs **~$3–7/mo**.

**Order-day reminder:** start parsley seeds the moment they arrive — germination
takes 10–28 days and is the critical-path item. Soak 12–24 h before sowing.
