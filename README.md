# samogrow by Nombox 🌿

**Self-hosted herbs: a camera, two smart plugs, one Bun service — no subscription, no pods, no black box.**

DIY AI-controlled indoor herb garden — always-fresh herbs and greens: parsley, basil, cilantro, mint, lettuce.

![Field-guide illustration of the samogrow build — T5 grow lights above a DWC tote of herbs in net cups, top-up jug with pump, Wi-Fi camera, air pump, and two smart plugs](docs/img/build-illustration.jpg)

*The build, illustrated — real photos will replace this once the first unit is assembled. (An [AI-generated mock-up](docs/img/hero-mock.jpg) of the finished result also exists — explicitly a render, not a photo.)*

An affordable, kit-style alternative to commercial smart gardens (Auk, Click & Grow, Rise Gardens).
The garden device itself is dumb and Wi-Fi-only: smart plugs switch the grow light and the pump,
a Wi-Fi camera watches the plants. The brain — a TypeScript/Bun service calling the Claude API —
runs on a laptop/VM elsewhere, decides watering/lighting, and reports/accepts commands via Telegram.
No Raspberry Pi, no soldering, no GPIO (an on-device Pi controller remains as a documented variant).

Open source (MIT license). The `software/` service is a small TypeScript/Bun app (`@anthropic-ai/sdk` for Claude vision, `grammY` for Telegram) with a green CI (108 tests). Try the whole loop before ordering any parts — mock mode runs it with zero hardware:

```
SAMOGROW_MOCK=1 bun run src/main.ts
```

## How it works

On a timer during light hours, the brain pulls a camera snapshot, asks Claude for a JSON verdict, toggles the light and pump smart plugs within hard safety caps, and reports on Telegram.

![samogrow system schematic — an always-on machine runs the Bun brain, talks to the Claude API and Telegram over the internet, and over Wi-Fi commands two Kasa smart plugs (light and pump), a jug top-up pump feeding the DWC tote, an always-on air pump, and a Tapo RTSP camera](docs/img/schematic.svg)

## Repo layout

- `research/` — market and parts research (commercial analogs, hydroponics methods, electronics, software stack)
- `spec/` — the build spec (samospec-style): goal, architecture, BOM with prices, assembly plan, sprint plan
- `software/` — the brain: control loop, camera + AI vision analysis, Telegram bot
- `docs/` — the [project site](https://nikolays.github.io/samogrow/) (static GitHub Pages, no deployment build step; npm is used only for tests)

## Website languages

The site is available in 20 languages: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Ukrainian, Turkish, Arabic, Hindi, Bengali, Indonesian, Vietnamese, Thai, Japanese, Korean, and Chinese. Locale precedence is a shareable `?lang=<code>` URL parameter, then a manual topbar choice remembered in `localStorage`, then browser auto-detection via `navigator.languages`, and finally English. The active locale is written back to `?lang=` without reloading or losing other query parameters or the page anchor, so links such as `https://samogrow.dev/?lang=uk#incidents` open directly in the intended language. If a locale file cannot load, the baked-in English page remains visible, the URL reflects the actual fallback, and a failed manual choice is not remembered. Translations live in `docs/i18n/*.json` (one flat key→string file per language) applied by dependency-free `docs/i18n.js`; `npm run test:docs` checks locale parity, labels, DOM behavior, fetch failures, and selection logic.

To add a language, add its entry to `LOCALES` in `docs/i18n.js`, add the same code to the pre-paint `codes` roster in `docs/i18n-bootstrap.js`, and create `docs/i18n/<code>.json` with exactly the English catalog's keys. Run `npm run test:docs`; roster/key parity and the duplicated pre-paint matcher are enforced by the suite.

The site also carries a separate **incident blog** at `blog.html`, with one shareable page per dated, severity-tagged field-test incident (×10 nutrient overdose, transplant-borne leafroller, camera-missed aphids, neem phototoxicity). Language selection follows every internal blog link. Evidence photos are served locally from `docs/img/incidents/`, and each post links to its full RCA issue. All prices on the site are labeled as a rough **U.S. mid-2026 baseline in USD**, with the rough Poland / EU-plug complete-basket estimate shown beside it in the top summary and detailed lower down (snapshot observed 2026-08-20) — explicitly not a checkout quote, and with a warning that generic Tuya-style plugs/cameras need adapter work with the current software.

Status: spec + shopping list + software ready — see the [project brief](https://nikolays.github.io/samogrow/), [SPEC](spec/SPEC.md), and [shopping list](spec/SHOPPING-LIST.md).

Ready to build? The 10 core V1 items are collected in one [ready-to-order Amazon list](https://www.amazon.com/hz/wishlist/ls/3SF86IUAST80H) (~$216) — cart them in one pass; buy the tote and the plants in person, and the 3" hole saw + 0.1 g scale only if you don't already own them.
