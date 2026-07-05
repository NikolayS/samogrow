# samogrow 🌿

DIY AI-controlled indoor herb garden — always-fresh parsley and greens.

An affordable, kit-style alternative to commercial smart gardens (Auk, Click & Grow, Rise Gardens).
The garden device itself is dumb and Wi-Fi-only: smart plugs switch the grow light and the pump,
a Wi-Fi camera watches the plants. The brain — a TypeScript/Bun service calling the Claude API —
runs on a laptop/VM elsewhere, decides watering/lighting, and reports/accepts commands via Telegram.
No Raspberry Pi, no soldering, no GPIO (an on-device Pi controller remains as a documented variant).

## Repo layout

- `research/` — market and parts research (commercial analogs, hydroponics methods, electronics, software stack)
- `spec/` — the build spec (samospec-style): goal, architecture, BOM with prices, assembly plan, sprint plan
- `software/` — the brain: control loop, camera + AI vision analysis, Telegram bot

Status: research in progress.
