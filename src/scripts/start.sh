#!/bin/sh
set -e

# Container start path. Everything expensive (pnpm install, prisma generate,
# tsc) happens at image build time -- this script only applies migrations and
# execs the already-compiled server, so a restart costs ~2s instead of ~50s.

echo "=== Starting next-esentry-nodejs ==="
echo "NODE_ENV=${NODE_ENV} PORT=${PORT}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set. Link the PostgreSQL service in Railway."
  exit 1
fi

if [ -z "$REDIS_URL" ]; then
  echo "ERROR: REDIS_URL is not set. Link the Redis service in Railway."
  exit 1
fi

# Apply migrations. Prisma waits for the database itself, so no nc polling.
# A migration failure must abort the boot (set -e) rather than start a server
# against an out-of-date schema.
echo "Applying database migrations..."
pnpm prisma migrate deploy --schema ./node_modules/@mjw324/prisma-shared/prisma/schema.prisma

# exec so node is PID 1 and receives SIGTERM directly for graceful shutdown.
echo "Starting server..."
exec node dist/index.js
