#!/usr/bin/env bash
# Postgres 16 + Redis 8 for the harness, on 127.0.0.1:55432 / :56379.
#
#   bin/services.sh up|down|status|reset|createdb <name>
#   bin/services.sh psql -c 'select ...'          (PGDB=<name> to pick a db)
#   bin/services.sh redis-cli -n 1 keys '*'
#
# Where they run (HARNESS_SERVICES overrides the auto-detection):
#   wsl     Windows Git Bash -> WSL Ubuntu (default on Windows)
#   native  services/pg-redis.sh directly (default on Linux/macOS when Postgres 16 is installed)
#   docker  docker compose (docker-compose.yml), the fallback
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

detect_mode() {
  if [ -n "${HARNESS_SERVICES:-}" ]; then echo "$HARNESS_SERVICES"; return; fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) command -v wsl >/dev/null && { echo wsl; return; } ;;
  esac
  if command -v initdb >/dev/null || [ -x /usr/lib/postgresql/16/bin/initdb ] ||
     [ -x /opt/homebrew/opt/postgresql@16/bin/initdb ] || [ -x /usr/local/opt/postgresql@16/bin/initdb ]; then
    command -v redis-server >/dev/null && { echo native; return; }
  fi
  echo docker
}
MODE="$(detect_mode)"

case "$MODE" in
  wsl)
    DISTRO="${HARNESS_WSL_DISTRO:-Ubuntu}"
    WSL_SCRIPT="$(MSYS_NO_PATHCONV=1 wsl -d "$DISTRO" -e wslpath -a "$(cygpath -w "$HERE/services/pg-redis.sh")")"
    # Strip CR in case the checkout converted line endings.
    MSYS_NO_PATHCONV=1 exec wsl -d "$DISTRO" -e env PGDB="${PGDB:-esentry}" sh -c \
      'tr -d "\r" < "$0" > /tmp/esentry-pg-redis.sh && sh /tmp/esentry-pg-redis.sh "$@"' "$WSL_SCRIPT" "$@"
    ;;
  native)
    exec env PGDB="${PGDB:-esentry}" sh "$HERE/services/pg-redis.sh" "$@"
    ;;
  docker)
    DC=(docker compose -f "$HERE/docker-compose.yml")
    PG=esentry-harness-pg
    RD=esentry-harness-redis
    cmd="${1:-}"; shift || true
    case "$cmd" in
      up) "${DC[@]}" up -d --wait && echo "postgres 16 on :55432 (user harness), redis on :56379 (docker)" ;;
      down) "${DC[@]}" down ;;
      status) "${DC[@]}" ps ;;
      reset) "${DC[@]}" down -v && "${DC[@]}" up -d --wait && echo "reset: volumes recreated" ;;
      createdb)
        docker exec "$PG" psql -U harness -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$1'" | grep -q 1 ||
          docker exec "$PG" psql -U harness -d postgres -qc "CREATE DATABASE \"$1\"" ;;
      psql) exec docker exec -i "$PG" psql -U harness -d "${PGDB:-esentry}" "$@" ;;
      redis-cli) exec docker exec -i "$RD" redis-cli "$@" ;;
      *) echo "usage: $0 up|down|status|reset|createdb <name>|psql [args]|redis-cli [args]" >&2; exit 2 ;;
    esac
    ;;
  *) echo "unknown HARNESS_SERVICES=$MODE (wsl|native|docker)" >&2; exit 2 ;;
esac
