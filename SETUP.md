# Setting up the eSentry review workflow on a new workstation

You are an agent on a different machine than the one where this workflow was built (2026-10-11, Windows 11 + WSL). Follow this guide to recreate it, then continue the work described in "State of the work". Read `README.md` afterwards for day-to-day use of the harness.

**The goal:** be able to *run and drive* eSentry on any branch and observe every layer, so that changes are verified by behaviour rather than by reading diffs. There are two lanes:
- **Local lane (this harness):** both apps, Postgres 16, Redis 8, and a fake eBay + fake SES.
- **Production lane:** Railway MCP/CLI plus the live site, read-only.

---

## 1. What lives where

| Thing | Location | Public? |
|---|---|---|
| Backend | `git@github.com:mjw324/next-esentry-nodejs.git`, `main` = what Railway runs | public |
| Frontend | `git@github.com:mjw324/next-esentry.git`, `main` = what Vercel runs | public |
| Shared Prisma schema | npm `@mjw324/prisma-shared` (repo `mjw324/prisma-shared`) | public |
| **This harness** | backend repo, orphan branch **`tooling/e2e-harness`** | public |
| Perf work, code only | backend repo, branch **`perf/optimizations-code`**: the 16 perf commits + read-only `docs/audit-scripts/` | public |
| Railway IaC migration | backend repo, branch **`chore/railway-iac-migration`** (1 commit, not merged, cutover not run) | public |
| **Full perf branch with the audit write-ups** (`docs/BACKEND_AUDIT_2026-09.md`, `docs/BACKEND_OPTIMIZATION_2026-09.md`) | **private**: git bundle in the user's OneDrive, `Desktop/esentry-handoff/` | **no** |
| Agent memory notes from the old machine | `Desktop/esentry-handoff/memory/` (OneDrive) | no |

All three GitHub repos are **public**. The audit docs describe unpatched, exploitable issues in the live API, so they are deliberately kept off GitHub. **Never commit or push them, or text copied from them, to any of these repos.** If you write review docs that discuss security findings, keep them in the private handoff folder or ask the user where they should go.

## 2. Prerequisites

| Tool | Notes |
|---|---|
| git, with SSH access to `github.com:mjw324/*` | `ssh -T git@github.com` should greet the user |
| Node.js ≥ 20 | built and tested on 24.11 |
| pnpm | any recent version. pnpm ≥ 11 blocks dependency build scripts and exits 1 on `install`; the harness passes `--dangerously-allow-all-builds` and deletes the stray `pnpm-workspace.yaml` pnpm creates |
| Railway CLI ≥ 5.64 | `npm i -g @railway/cli`. The user must run `railway login` themselves (it's interactive, in a browser) |
| Postgres 16 + Redis 8 | pick one option in §4 |
| Bash | Git Bash on Windows; the scripts are bash |

## 3. Clone into one parent directory

The harness expects the repos to be its siblings:

```bash
mkdir -p ~/repositories && cd ~/repositories
git clone git@github.com:mjw324/next-esentry-nodejs.git
git clone git@github.com:mjw324/next-esentry.git
git clone -b tooling/e2e-harness --single-branch git@github.com:mjw324/next-esentry-nodejs.git esentry-harness
```

Then bring in the private branches from the bundle, if the user's OneDrive is on this machine. The bundle path depends on the OS; ask the user if you can't find it:

```bash
BUNDLE="<OneDrive>/Desktop/esentry-handoff/esentry-local-branches.bundle"
git -C next-esentry-nodejs bundle verify "$BUNDLE"
git -C next-esentry-nodejs fetch "$BUNDLE" \
  perf/optimizations:perf/optimizations \
  chore/railway-iac-migration:chore/railway-iac-migration
```

If OneDrive isn't available, `git fetch origin perf/optimizations-code` has the identical code but not the two audit docs. Ask the user to copy `esentry-handoff/` over some other way.

> Note: on the old machine the whole `repositories/` folder sat inside OneDrive, so a synced copy may show up here. Don't work in it (synced `.git` and `node_modules` folders are unreliable); use fresh clones plus the bundle.

## 4. Postgres 16 + Redis 8 (pick one)

The harness always connects to `127.0.0.1:55432` (user/password `harness`, database `esentry`) and `127.0.0.1:56379`. `bin/services.sh` auto-detects where they run, or you can force it with `HARNESS_SERVICES=wsl|native|docker`.

**A. Windows: WSL Ubuntu** (what the old machine used)

```bash
# one time, installs from the official PGDG and packages.redis.io apt repos, as WSL root (no password)
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -e sh "$(MSYS_NO_PATHCONV=1 wsl -d Ubuntu -e wslpath -a "$(cygpath -w esentry-harness/services/install-ubuntu.sh)")"
```

Gotchas: Git Bash mangles `/paths` passed to `wsl` unless you set `MSYS_NO_PATHCONV=1`. The WSL localhost relay takes a few seconds to expose new listeners, so a connection refused right after `up` usually just needs a retry. WSL sometimes restarts itself to finish an upgrade, which kills the services; rerun `bin/up.sh`. Set `HARNESS_WSL_DISTRO` if the distro isn't called `Ubuntu`.

**B. Linux (Debian/Ubuntu), native:** ask the user to run `sudo sh esentry-harness/services/install-ubuntu.sh`, which needs their sudo password. The harness then runs its own instances under `~/.esentry-harness`. Any system postgres/redis on 5432/6379 doesn't matter.

**C. macOS, native:** `brew install postgresql@16 redis`. `services/pg-redis.sh` finds the Homebrew binaries.

**D. Docker:** `HARNESS_SERVICES=docker bin/services.sh up` uses `docker-compose.yml` (postgres:16-alpine, redis:8.2-alpine). This is also the only way to test the backend's Dockerfile locally. The old machine's Docker Desktop 4.45 wouldn't start, most likely because it's too old for WSL 2.7.x; updating it was the fix, and factory resets weren't.

## 5. Bring it up and prove it works

Run each long-lived command as its own background process or terminal tab:

```bash
cd ~/repositories/esentry-harness
bin/worktree.sh perf/optimizations perf          # or perf/optimizations-code if you have no bundle
bin/up.sh                                        # services + fakes on :4010 (installs tools/ deps on first run)
bin/backend.sh --dir ../esentry-worktrees/perf --name perf     # :3000
bin/frontend.sh                                  # :3001
node tools/smoke.mjs                             # expect 15 PASS lines and "all steps passed"
```

Then check the browser lane. In the desktop app's built-in browser (or Playwright), open `http://localhost:3001/register`. Create a test account with an `@harness.test` address and a password you generate, and save both in `env/test-accounts.env` (gitignored) instead of putting them in chat. Get the verification link with `node tools/fake.mjs last-email --to <addr>` and open it. The dashboard should load. Then create a monitor, start it, run `node tools/tick.mjs` → `node tools/fake.mjs add "<matching title>"` → clear `ebay:search:*` in Redis → `tick` again. An alert should appear in `http://127.0.0.1:4010/__control/inbox`.

## 6. Production lane (read-only unless the user says otherwise)

- **Railway MCP:** `claude mcp add railway -- railway mcp proxy` (it uses the CLI's login). Useful tools: `environment-status`, `get-logs` (deploy/build/http streams), `http-requests`, `get-service-metrics`, `list-deployments`. If the user's org offers the `use-railway` skill/plugin, enable it.
- **IDs:** project `vivacious-luck` = `ca7346cf-8927-48e4-aa68-b6182de5ca4c`. Environment `production` = `bccaa6b4-9f3e-4370-88b6-936ce77c48a8`. Services: `next-esentry-nodejs` `725c685e-8ea4-4cce-ad02-dcec821cd2b6` (api.esentry.dev), `Postgres` `772d06ec-ed31-47ad-8a82-4e5916254e48`, `Redis` `372c3224-2753-4d1f-a2b2-535559adcd26`. The frontend is on Vercel at www.esentry.dev.
- **Read-only DB/Redis queries:** the MCP can't read service credentials. Link a scratch directory with `railway link -p ca7346cf-8927-48e4-aa68-b6182de5ca4c -e production -s Postgres`, then `railway run -s Postgres -- node <repo>/docs/audit-scripts/pg_audit.js` (that sets `DATABASE_PUBLIC_URL`) or `railway run -s Redis -- node .../redis_audit.js` (`REDIS_PUBLIC_URL`).
- **Retention:** deploy logs only go back about 2 days.
- **Live UI:** the browser pane on `https://www.esentry.dev`. The user signs in themselves; never type their real credentials.
- **The user's stance:** nobody else uses production, so testing there is acceptable. Still ask before anything that writes or deploys: deploying a branch, creating a Railway environment, `railway config migrate cutover`/`apply`, or sending real email. Don't boot a non-main backend against production data; it would compete with the live worker and reschedule monitors.

## 7. Safety rules baked into the harness (keep them)

- `preload/egress.cjs` (via `NODE_OPTIONS=--require`) reroutes eBay and SES to the fakes and **blocks every other HTTPS host**. `node tools/fake.mjs egress` should stay empty. It doesn't intercept global `fetch`/undici.
- `bin/backend.sh` refuses to run when Railway env vars are present, and never reads the backend repo's `.env.local`. **That file holds production secrets**, and it's gitignored, so a fresh clone won't have one. Don't create one.
- Everything in `env/*.env` is a fake or local value.

## 8. State of the work (as of 2026-10-11)

**Branches**

| Branch | State |
|---|---|
| `main` (`1d2f574`) | deployed on Railway; last backend deploy 2026-05-31 |
| `perf/optimizations` (private bundle) / `perf/optimizations-code` (public) | 16 perf commits from the Sept audit, unmerged. Most were checked only with "tsc clean" until 2026-10-11, when the branch passed the harness smoke test for the first time |
| `chore/railway-iac-migration` | `.railway/railway.ts` + `railway@3.13.1` dev dep. `railway config plan` was clean (moves builder/healthcheck/restart policy out of `railway.json`). Cutover and apply have **not** been run; Railway requires it before 2026-12-01. On Windows the `railway` npm package's CLI check fails; set `$env:_` to the real `railway.exe` path |
| frontend `main` (`fe27ff3`) | unchanged |

**Findings from building the harness** (details in `README.md` → Discoveries):
1. **The next Railway build will probably fail.** The Dockerfile runs an unpinned `npm install -g pnpm`, which now installs pnpm 12.11.2, and its `install --frozen-lockfile --prod` exits 1 on ignored build scripts (reproduced on Windows; not yet in a Linux/Railway build). This blocks the IaC cutover too. Fix: pin pnpm and/or set `pnpm.onlyBuiltDependencies`.
2. **Market Insights returns 400 whenever the price range is unset.** The frontend sends `minPrice: null`; the backend's zod schema allows only a number or a missing field. Very likely broken in production; confirm with the user's session.
3. **Lead:** a newly activated monitor's first check waits up to interval + scheduler offset on the perf branch. Compare with `main`.
4. Railway shows an empty staged environment patch from 2026-04-01 (`pendingWork` in `environment-status`). Mention it to the user, but don't apply or discard it.

**Next step:** run the long review described in `REVIEW_PROMPT.md` (the user drafted the intent; adjust paths for this machine).

## 9. Restore agent memory (optional but useful)

`esentry-handoff/memory/*.md` are the old machine's Claude Code memory notes for this project: Railway IDs, the audit summary, repo drift, the harness, and the pnpm risk. Copy them into this machine's memory directory for the backend project (`~/.claude/projects/<encoded path of next-esentry-nodejs>/memory/`) and append their index lines to `MEMORY.md` there. Treat them as point-in-time notes and check them against the repos before relying on them.
