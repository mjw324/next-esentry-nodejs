# eSentry test harness

A way to **run and drive** eSentry (backend `next-esentry-nodejs`, frontend `next-esentry`) on any branch, plus a production lane for checks that only production can answer. Built 2026-10-11 for reviewing the `perf/optimizations` branch and the September audit docs, and reusable after that.

Lives next to the two repos, so it works whichever branch is checked out and adds nothing to either repo.

```
repositories/
  next-esentry-nodejs/     backend (main checkout, untouched)
  next-esentry/            frontend (cloned 2026-10-11 from github.com/mjw324/next-esentry)
  esentry-worktrees/       extra backend checkouts for side-by-side runs (bin/worktree.sh)
  esentry-harness/         this
```

## Two lanes

| | Local lane (this harness) | Production lane |
|---|---|---|
| Code | any branch or commit, including unmerged ones | whatever Railway has deployed (`origin/main`) |
| eBay | **fake** with scripted listings, fault injection, a call log | real eBay, real quota |
| Email | **fake SES** inbox you can browse | real SES, real inboxes |
| Data | throwaway Postgres 16 / Redis 8 in WSL | real Railway Postgres/Redis |
| Good for | A/B comparisons, failure modes, timing, counters, "does this branch even boot" | real eBay response shapes, real delivery, deploy/build behaviour, Railway metrics |
| Eyes | `tools/*.mjs`, the backend's JSON logs, the browser pane on `localhost:3001` | Railway MCP (`get-logs`, `http-requests`, `get-service-metrics`, `environment-status`), the CLI read-only scripts (`docs/audit-scripts/` on the perf branch), the browser pane on `www.esentry.dev` |

## Quickstart (local lane)

Run each of the first three as its own long-lived process (a background task or a terminal tab):

```bash
bin/up.sh                                                    # WSL Postgres/Redis + fakes on :4010
bin/backend.sh --dir ../esentry-worktrees/perf --name perf   # API on :3000 (default --dir is the main checkout)
bin/frontend.sh                                              # Next.js on :3001
node tools/smoke.mjs                                         # 15-step end-to-end check, exits non-zero on failure
```

First time only: `bin/worktree.sh perf/optimizations perf` creates the worktree. `cd tools && npm install` happens automatically in `up.sh`.

**Browser:** the desktop app's built-in browser pane can open `http://localhost:3001`. Register any `@harness.test` address. The verification link shows up in `node tools/fake.mjs last-email --to <addr>` and in the inbox page at `http://127.0.0.1:4010/__control/inbox`. A ready-made verified account is in `env/test-accounts.env` (local only).

**API without the UI:** `node tools/seed.mjs` prints a verified `userId`. Send it as the `user-id` header. That header is the whole authentication model (audit F-1).

## Tools

| Command | What it shows / does |
|---|---|
| `node tools/inspect.mjs [--redis-db N] [--db NAME] [--only redis\|queue\|pg]` | Redis keys by prefix, memory, quota counter, backoff state, search cache, rate-limit keys; BullMQ counts, job schedulers, delayed jobs, recent failures; users, monitors (counters, lastCheckTime), alert emails, sessions, applied migrations |
| `node tools/tick.mjs [--monitor ID]` | Runs scheduled monitor jobs **now** by promoting their delayed job. Production intervals are 5 min to 2 h. |
| `node tools/fake.mjs calls [--summary]` | Every Browse/OAuth call the backend made: q, filter, sort, limit, fieldgroups, status, results |
| `node tools/fake.mjs add "<title>" --price 199 --condition 3000` | A new listing "appears on eBay" |
| `node tools/fake.mjs fault '{"delayMs":15000}'` | Also `{"failNext":3,"status":503}`, `{"failRate":0.3}`, `{"emptyResults":true}`. Clear with `clear-faults`. |
| `node tools/fake.mjs emails` / `last-email` | Captured SES sends from both apps |
| `node tools/fake.mjs egress` | Outbound HTTPS the guard blocked (should be empty) |
| `bin/services.sh psql -c "select ..."` / `bin/services.sh redis-cli -n 0 keys '*'` | Raw access |
| `bin/services.sh reset` | Wipe every local database and flush Redis |

## Side-by-side runs (baseline vs branch)

```bash
bin/worktree.sh origin/main main
bin/backend.sh --dir ../esentry-worktrees/main --name main --port 3100 --db esentry_main --redis-db 1
bin/backend.sh --dir ../esentry-worktrees/perf --name perf --port 3000 --db esentry      --redis-db 0
node tools/smoke.mjs --api http://localhost:3100 --db esentry_main --redis-db 1
```

Both instances share the one fake eBay, so `fake.mjs calls` gives a direct call-count comparison, for example for P-4 backoff, P-5 shared search, or P-16 timeouts under `fault`. Logs go to `logs/backend-<name>.log` and are JSON on the perf branch.

## How it stays hermetic

- `preload/egress.cjs` is injected with `NODE_OPTIONS=--require` into both apps. It reroutes `*.ebay.com` and `email*.amazonaws.com` to the fakes and **blocks every other non-local HTTPS host**. Neither app's code is modified.
- Gap: global `fetch()`/undici is not intercepted. The backend uses axios and the AWS SDK, which are covered. The frontend's only outbound calls are SES (covered) and OAuth providers (social login doesn't work here; email/password does).
- `bin/backend.sh` refuses to start if Railway env vars are present, and never reads the repo's `.env.local`. That file holds **production** secrets.
- Postgres/Redis run under `~/.esentry-harness` in WSL Ubuntu on ports 55432/56379, separate from any system services. `bin/up.sh` holds a WSL session open, because an idle distro shuts down and takes them with it.

## What the local lane does not cover

- **The Dockerfile / `start.sh` path.** The backend runs as `tsc` + `node dist/index.js`. Docker Desktop 4.45 currently fails to start on this machine (likely too old for WSL 2.7.14; updating it is the fix). Image changes (P-1) need a real build: updated Docker Desktop, or a Railway build in a non-production environment.
- **Real eBay semantics.** The fake does AND keyword matching, `(a,b)` OR groups, `-term`, and price/condition/seller filters, and leaves out `itemSummaries` on zero results, like eBay does. It does not model relevance, `itemStartDate` filters (P-6), or eBay's real error bodies. Check those in the production lane.
- **Time.** `tick.mjs` stands in for waiting. It does not move the clock forward, so 24 h TTLs, daily quota reset, and session expiry need Redis TTL edits or real waiting.

## Discoveries made while building this (2026-10-11)

1. **Deploys will likely fail: unpinned pnpm in the Dockerfile.** Both `main` and `perf/optimizations` run `npm install -g pnpm`, which installs **pnpm 12.11.2** today. Reproduced locally: `pnpm@12.11.2 install --frozen-lockfile --prod` on the perf `package.json` + lockfile **exits 1** with `Ignored build scripts: @prisma/client, @prisma/engines, msgpackr-extract, prisma`. pnpm 11 does the same. Railway's last backend deploy was 2026-05-31; the next build, including `railway config migrate cutover` on the IaC branch, will probably fail. Fix: pin pnpm (`packageManager` + corepack, or `npm i -g pnpm@<lockfile major>`) and/or allowlist those builds via `pnpm.onlyBuiltDependencies`.
2. **Market Insights returns 400 for any monitor without a price range.** The frontend sends `"minPrice":null,"maxPrice":null` (seen in the browser), and the backend's `insightsParamsSchema` uses `z.number().optional()`, which rejects `null`. Same code on deployed `main` (`d040b07` / frontend `fe27ff3`), so production is probably affected. Not yet confirmed there: it needs a real logged-in session, because a fake `user-id` gets a 500 before validation.
3. **Lead: delayed first check after activation.** A new 2 h monitor's first job was scheduled ~1.6 h after activation (scheduler offset from `043b891`). Verify against `main`: does activation run immediately there?
4. **The perf branch boots and passes the 15-step smoke test.** This is the first full boot of the compiled branch; §5 of `BACKEND_OPTIMIZATION_2026-09.md` says that was never run.
5. Prisma CLI telemetry (`checkpoint.prisma.io`) runs on every generate/migrate. The egress guard caught it. Disabled here with `CHECKPOINT_DISABLE=1`.

## Stop everything

Stop the `up.sh` / `backend.sh` / `frontend.sh` processes, then:

```bash
bin/services.sh down
```
