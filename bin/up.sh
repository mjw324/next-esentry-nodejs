#!/usr/bin/env bash
# Start the harness infrastructure and keep it alive:
#   WSL Postgres/Redis + fakes server (eBay + SES) on :4010.
# Run this as a long-lived process (background task or terminal tab).
# Ctrl+C / kill stops the fakes; Postgres/Redis keep running until bin/services.sh down.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HERE/logs"

"$HERE/bin/services.sh" up

# WSL shuts an idle distro down, taking Postgres/Redis with it. Hold a session.
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -e sleep infinity &
KEEPALIVE=$!
trap 'kill $KEEPALIVE 2>/dev/null || true' EXIT

# The WSL localhost relay takes a few seconds to pick up new listeners.
for _ in $(seq 1 30); do
  node -e "const s=require('net').connect(56379,'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1))" && break
  sleep 1
done

[ -d "$HERE/tools/node_modules" ] || (cd "$HERE/tools" && npm install --silent --no-audit --no-fund)

echo "[up] fakes log: $HERE/logs/fakes.log"
node "$HERE/fakes/server.mjs" 2>&1 | tee "$HERE/logs/fakes.log"
