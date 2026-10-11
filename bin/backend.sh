#!/usr/bin/env bash
# Build and run a next-esentry-nodejs checkout against the local harness.
#
#   bin/backend.sh [--dir PATH] [--name NAME] [--port 3000] [--db esentry] [--redis-db 0] [--no-build] [--no-migrate]
#
# --dir defaults to ../next-esentry-nodejs (whatever branch is checked out).
# For side-by-side comparisons, run a second instance from a worktree
# (bin/worktree.sh) with its own --port, --db and --redis-db.
#
# Mirrors the production start path (migrate deploy, then compiled node), but
# skips the Dockerfile/start.sh. Image-level changes need a Railway build.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HERE/../next-esentry-nodejs"
NAME=""
PORT=3000
DB=esentry
RDB=0
BUILD=1
MIGRATE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --redis-db) RDB="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --no-migrate) MIGRATE=0; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
DIR="$(cd "$DIR" && pwd)"
NAME="${NAME:-$(basename "$DIR")-$PORT}"
mkdir -p "$HERE/logs"
LOG="$HERE/logs/backend-$NAME.log"

if [ -n "${RAILWAY_ENVIRONMENT:-}${RAILWAY_PROJECT_ID:-}" ]; then
  echo "refusing to run: Railway environment variables are present (railway run?)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. <(tr -d '\r' < "$HERE/env/backend.env")
set +a
export PORT
export DATABASE_URL="postgresql://harness:harness@127.0.0.1:55432/$DB"
export REDIS_URL="redis://127.0.0.1:56379/$RDB"
export NODE_OPTIONS="--require $(command -v cygpath >/dev/null && cygpath -m "$HERE/preload/egress.cjs" || echo "$HERE/preload/egress.cjs") ${NODE_OPTIONS:-}"

"$HERE/bin/services.sh" createdb "$DB" >/dev/null

cd "$DIR"
echo "[backend] $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)  dir=$DIR  port=$PORT db=$DB redis-db=$RDB"
[ -d node_modules ] || { pnpm install --frozen-lockfile --dangerously-allow-all-builds; git ls-files --error-unmatch pnpm-workspace.yaml >/dev/null 2>&1 || rm -f pnpm-workspace.yaml; }
if [ "$MIGRATE" = 1 ]; then
  pnpm exec prisma migrate deploy --schema node_modules/@mjw324/prisma-shared/prisma/schema.prisma
fi
if [ "$BUILD" = 1 ]; then
  rm -rf dist
  pnpm exec tsc
fi
echo "[backend] log: $LOG"
exec node dist/index.js 2>&1 | tee "$LOG"
