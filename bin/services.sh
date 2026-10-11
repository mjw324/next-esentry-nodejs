#!/usr/bin/env bash
# Windows-side wrapper (Git Bash) for the WSL-hosted Postgres/Redis.
#   bin/services.sh up|down|status|reset|createdb <name>
#   bin/services.sh psql -c 'select ...'          (PGDB=<name> to pick a db)
#   bin/services.sh redis-cli -n 1 keys '*'
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# /mnt/c/... path of the WSL-side script
WSL_SCRIPT="$(MSYS_NO_PATHCONV=1 wsl -d Ubuntu -e wslpath -a "$(cygpath -w "$HERE/services/wsl-services.sh")")"
# Strip CR in case the checkout converted line endings.
MSYS_NO_PATHCONV=1 exec wsl -d Ubuntu -e env PGDB="${PGDB:-esentry}" sh -c 'tr -d "\r" < "$0" > /tmp/esentry-wsl-services.sh && sh /tmp/esentry-wsl-services.sh "$@"' "$WSL_SCRIPT" "$@"
