#!/bin/sh
# Runs INSIDE WSL Ubuntu (as the normal user). Harness-owned Postgres 16 and
# Redis 8 instances on non-default ports, with data under ~/.esentry-harness,
# completely separate from any system-wide postgres/redis service.
#
#   sh wsl-services.sh up|down|status|reset|psql [args]|redis-cli [args]
set -e

ROOT="$HOME/.esentry-harness"
PGBIN=/usr/lib/postgresql/16/bin
PGDATA="$ROOT/pg"
PGPORT=55432
REDISPORT=56379
PGUSER_NAME=harness
PGPASS=harness

pg_init() {
  [ -f "$PGDATA/PG_VERSION" ] && return 0
  mkdir -p "$ROOT"
  printf '%s\n' "$PGPASS" > "$ROOT/.pwfile"
  "$PGBIN/initdb" -D "$PGDATA" -U "$PGUSER_NAME" --pwfile="$ROOT/.pwfile" --auth=scram-sha-256 -E UTF8 >/dev/null
  rm -f "$ROOT/.pwfile"
  cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '*'
port = $PGPORT
unix_socket_directories = '$ROOT'
log_min_duration_statement = 250
EOF
  echo "host all all 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
  echo "host all all ::/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
}

pg_up() {
  pg_init
  if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then return 0; fi
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$ROOT/pg.log" -w start >/dev/null
  PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='esentry'" | grep -q 1 ||
    PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -qc "CREATE DATABASE esentry"
}

redis_up() {
  mkdir -p "$ROOT/redis"
  redis-cli -p $REDISPORT ping >/dev/null 2>&1 && return 0
  # Mirrors production defaults: no maxmemory, noeviction.
  redis-server --port $REDISPORT --bind 0.0.0.0 --protected-mode no \
    --dir "$ROOT/redis" --save "" --appendonly no --daemonize yes \
    --logfile "$ROOT/redis.log" --maxmemory-policy noeviction
  for _ in 1 2 3 4 5 6 7 8 9 10; do redis-cli -p $REDISPORT ping >/dev/null 2>&1 && return 0; sleep 0.3; done
  echo "redis failed to start; see $ROOT/redis.log" >&2; exit 1
}

case "$1" in
  up)
    pg_up
    redis_up
    echo "postgres 16 on :$PGPORT (user $PGUSER_NAME), redis on :$REDISPORT"
    ;;
  down)
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
    redis-cli -p $REDISPORT shutdown nosave >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && echo "postgres: up (:$PGPORT)" || echo "postgres: down"
    redis-cli -p $REDISPORT ping >/dev/null 2>&1 && echo "redis: up (:$REDISPORT) $(redis-cli -p $REDISPORT info server | grep redis_version | tr -d '\r')" || echo "redis: down"
    ;;
  reset)
    # Wipe all data: drop every non-template database, flush every redis db.
    pg_up; redis_up
    for db in $(PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -tAc \
        "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')"); do
      PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -qc "DROP DATABASE \"$db\" WITH (FORCE)"
    done
    PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -qc "CREATE DATABASE esentry"
    redis-cli -p $REDISPORT flushall >/dev/null
    echo "reset: databases dropped (esentry recreated), redis flushed"
    ;;
  createdb)
    pg_up
    PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$2'" | grep -q 1 ||
      PGPASSWORD=$PGPASS "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d postgres -qc "CREATE DATABASE \"$2\""
    ;;
  psql)
    shift
    DB=${PGDB:-esentry}
    PGPASSWORD=$PGPASS exec "$PGBIN/psql" -h "$ROOT" -p $PGPORT -U $PGUSER_NAME -d "$DB" "$@"
    ;;
  redis-cli)
    shift
    exec redis-cli -p $REDISPORT "$@"
    ;;
  *)
    echo "usage: $0 up|down|status|reset|createdb <name>|psql [args]|redis-cli [args]" >&2
    exit 2
    ;;
esac
