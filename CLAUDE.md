# samogrow — working agreement

## Workflow: everything goes through a PR

**No direct commits to `main`.** All changes — code and substantive docs/spec — land on `main` only via a Pull Request that has passed the merge gate below. Work on a branch, open a PR, drive it through the gate, then merge.

- Branch naming: `fix/…`, `feat/…`, `docs/…`.
- Keep PRs focused and reviewable.
- End commit messages with the co-author / session trailers as usual.

## Merge gate (all three must pass before merge)

A PR may be merged only when **all** of the following hold. If any is off, **fix it and repeat the cycle** — re-run CI, re-review, re-test — until all three pass.

1. **CI is green and the tests are well shaped.**
   - The `software CI` workflow passes (typecheck + tests + mock smoke run).
   - Tests actually exercise the change (right altitude, meaningful assertions), not just coincidental coverage. A green run over weak tests does not satisfy this gate.

2. **Review done via [github.com/Tanya301/samorev](https://github.com/Tanya301/samorev) and passing.**
   - Run the samorev review on the PR; it must pass.
   - **Invocation** (from a local clone of samorev — `git clone`, `bun install`, `bun run build`):
     ```bash
     bun run samorev review <PR-URL> --no-comment --blocking
     ```
     `--blocking` exits non-zero if blocking issues are found; `--no-comment` prints locally without posting. Inside a Claude Code session, `/review-mr <PR-URL> --blocking` runs the same.
   - Address every finding (fix or an explicit, justified dismissal) before the gate is considered met.

3. **Manual testing done, with evidence in the PR comments.**
   - Exercise the change against reality (real hardware / real flow where applicable — e.g. plug toggles, camera frame, end-to-end loop), not just unit tests.
   - Post the evidence as a PR comment: what was run, the observed result (logs, a captured frame, a metric). Claims of "tested" without posted evidence do not satisfy this gate.

**If something is off at any gate, it must be fixed and the cycle repeats** — do not merge on a partial pass.

## Notes for this repo

- **First-contact matters.** The smart-plug (KLAP) and camera (RTSP) integrations are validated against real TP-Link hardware; two real bugs were only found by testing against the actual device (TCP-bound KLAP session; newer firmware's method/params command schema). Treat "works in mock mode" as necessary but not sufficient — the manual-testing gate exists for this reason.
- **Safety-critical code** (pump caps, lockout, KLAP/plug control) deserves the most scrutiny at every gate.
- Secrets live in `software/.env` (gitignored) and env vars — never in commits, PRs, or comments.
