# Long-running review prompt (draft)

Paste the text below into a new Claude Code session opened in `repositories/next-esentry-nodejs`. Edit the scope lines first if needed.

---

Review the work recorded on branch `perf/optimizations` of this repo: 18 commits on top of `origin/main`, plus `docs/BACKEND_AUDIT_2026-09.md` and `docs/BACKEND_OPTIMIZATION_2026-09.md`. Most commits were checked only with "tsc clean". Your job is to **verify behaviour by running the system**, not by reading the diff alone. For each commit, decide: correct / correct but a better version exists / wrong. Also report anything you discover underneath.

**Read first:** `../esentry-harness/README.md`. It explains the two lanes, the tools, and what each lane cannot cover.

**Local lane (default for every claim you can reproduce):**
- Start `../esentry-harness/bin/up.sh`, then run both `origin/main` and `perf/optimizations` side by side (see "Side-by-side runs" in the README) against the shared fake eBay. Keep each as a background process.
- Run `node tools/smoke.mjs` against both first. Then, for each commit, write a targeted scenario: use `tools/tick.mjs` to force runs, `tools/fake.mjs` for listings, faults and call counts, and `tools/inspect.mjs` for Redis/BullMQ/Postgres state. Compare main and perf. Where you can, quote numbers (calls, round trips, keys, rows written).
- Drive the UI in the built-in browser pane on `http://localhost:3001` for anything user-facing (monitor create/edit/toggle/delete, alert email flows, Market Insights, unsubscribe). Use the test account in `../esentry-harness/env/test-accounts.env`.
- Save reusable scenarios as new scripts in `../esentry-harness/tools/scenarios/` so they can be rerun.

**Production lane (only for what the local lane cannot answer):**
- Read only: Railway MCP `get-logs`, `http-requests`, `get-service-metrics`, `environment-status` for project `ca7346cf-8927-48e4-aa68-b6182de5ca4c`, plus the read-only scripts in `docs/audit-scripts/` via `railway run`.
- The UI at `https://www.esentry.dev` in the browser pane, using my existing login there. Ask me to sign in if needed; never enter credentials yourself.
- Ask before anything that writes to production or deploys, including creating a Railway environment, deploying a branch, `railway config` cutover/apply, or sending real emails.

**Known leads to confirm or refute first** (from building the harness, see README "Discoveries"):
1. Unpinned `npm install -g pnpm` in the Dockerfile + pnpm 12 → `pnpm install --frozen-lockfile` exits 1 (ignored build scripts). Is the next Railway build broken? What is the smallest fix?
2. Market Insights 400s when price is unset (`null` vs `z.number().optional()`). Confirm in production with my session, then propose the fix on the right side (frontend, backend, or both).
3. First check after activation is delayed by up to interval + offset on perf. Is that a regression from `main`?

**Public vs private:** the GitHub repos are public, and the audit docs live only in the private bundle (see `SETUP.md` §1). Never push the audit docs, or review text that describes exploitable security issues, to GitHub.

**Output:** `docs/REVIEW_2026-10.md` on a new local branch off `perf/optimizations`, with a per-commit verdict table (claim → how you tested → evidence → verdict). Include a list of new findings ranked by severity, and the exact commands to reproduce each one. Fixes go in separate commits on that branch, each with the scenario that proves it. Don't push or open a PR until I ask.
