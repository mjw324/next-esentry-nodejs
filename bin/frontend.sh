#!/usr/bin/env bash
# Run the next-esentry frontend (Next.js dev server on :3001) against the harness.
#
#   bin/frontend.sh [--dir PATH] [--backend-port 3000] [--db esentry]
#
# Sign up with any address @harness.test; the verification email lands in the
# fakes inbox: http://127.0.0.1:4010/__control/inbox
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HERE/../next-esentry"
BPORT=3000
DB=esentry
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --backend-port) BPORT="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
DIR="$(cd "$DIR" && pwd)"
mkdir -p "$HERE/logs"

set -a
# shellcheck disable=SC1091
. <(tr -d '\r' < "$HERE/env/frontend.env")
set +a
export DATABASE_URL="postgresql://harness:harness@127.0.0.1:55432/$DB"
export BACKEND_API_URL="http://localhost:$BPORT"
export NEXT_PUBLIC_BACKEND_API_URL="http://localhost:$BPORT"
export NODE_OPTIONS="--require $(cygpath -m "$HERE/preload/egress.cjs") ${NODE_OPTIONS:-}"

cd "$DIR"
if [ -f .env.local ] || [ -f .env ]; then
  echo "[frontend] note: $DIR has .env/.env.local; harness env vars take precedence over them" >&2
fi
echo "[frontend] $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)  backend=$BACKEND_API_URL db=$DB"
[ -d node_modules ] || { pnpm install --frozen-lockfile --dangerously-allow-all-builds; git ls-files --error-unmatch pnpm-workspace.yaml >/dev/null 2>&1 || rm -f pnpm-workspace.yaml; }
echo "[frontend] log: $HERE/logs/frontend.log"
exec pnpm dev 2>&1 | tee "$HERE/logs/frontend.log"
