# samogrow — QA test report

**Date:** 2026-07-05 · **Scope:** all user stories, all build variants, software, docs, live site
**Method:** four independent QA agents (software hands-on driving, builder walkthrough, live-site audit, math/links audit), findings fixed same day, fixes re-verified.

## Verdict: PASS (after fixes)

## 1. Software — hands-on (9/9 PASS, no bugs)

| # | Story | Verdict | Evidence |
|---|---|---|---|
| 1 | Boot: auto + manual watering modes | PASS | both boot clean; pump-OFF safety only when pump exists |
| 2 | Light schedule incl. overnight windows | PASS | day/overnight/half-open/override-expiry all correct |
| 3 | Pump safety: caps, lockout, persistence | PASS | 100s→3s clamp, budget→0, lockout at 1 W, survives restart |
| 4 | Hostile AI verdicts clamped | PASS | 999999 ml→500, health −50→0, junk stages→safe defaults |
| 5 | Conversation tools: big-water confirmation | PASS | 5000 ml → confirmation gate, never direct |
| 6 | Timelapse → valid MP4 | PASS | ffprobe: h264, 720p, frame sampling capped |
| 7 | /set overrides: whitelist, caps lower-only | PASS | 30→40 refused; stale 9999 override refused |
| 8 | Trends math + sparklines | PASS | sums/deltas recompute exactly |
| 9 | Clean install, typecheck, tests | PASS | 119 tests, 0 fail (after multi-unit addition) |

## 2. Builder walkthrough (user stories 1–5 PASS; 5 gaps found → all fixed)

- User stories (SPEC §2): continuous harvest, Telegram control, DIY-but-practical,
  price/quality, mains safety — **all PASS** with citations.
- Gaps found → fixed in v1.3.1:
  - no drill / 3″ hole saw / mounting hardware / gram scale in BOM → **Tools block + mounts added**
  - EC target with no EC meter → **TDS meter added (required, ~$13)**
  - MasterBlend ratio absent → **2.4/2.4/1.2 g-per-gal ratio documented**
  - 3 Kasa products sharing one ASIN → **distinct links**
  - SPEC chat-id instruction wrong; ffmpeg/keep-awake missing → **corrected**
  - transplant step ignored parsley's 10–28-day germination → **reworded per-species**
- V4 A/B promise vs code (single merged verdict) → **fixed in software: per-unit
  labeled analysis, per-unit trends, A/B compare in weekly review, pump scoped to its unit**

## 3. Live site + docs (6/6 PASS)

Links (19 Amazon + GitHub + vendors) resolve; all 15 images serve with alt text;
meme strip appears exactly once with working attribution; claims audit true
(MIT license exists, CI real and green, test count accurate); desktop render clean.

## 4. Math + product links (2 errors + rounding → all fixed)

- All variant totals, marginal costs, superset cart, API cost math ($0.0036/analysis
  → $2.6–5.2/mo), and 2-year TCO deltas recompute correctly.
- Fixed: SPEC §4.0a "~$455" mislabel; Gardyn 3-yr TCO corrected to >$2,100;
  V3 cross-file $320/$321 unified; $225→$220 down-rounding eliminated.
- **Canonical cost frame (post-fix): V1 ~$240 · V2 ~$285 · V3 ~$340** (now includes
  EC meter and mounting — honest, no rounding games).
- No dead links (one Home Depot 403 = bot-block, inconclusive).

## Residual known limitations (documented, accepted)

- Manual mode (V1): no vacation autonomy — by design.
- Pump-health (V2 without V3): proves power draw, not water delivery — sight gauge (V3) closes this.
- Live Pages deploy can lag pushes by one build (~1 min); flaky legacy deployer occasionally needs a retrigger.
- AI-generated imagery is labeled as such; real photos replace it after first assembly.
