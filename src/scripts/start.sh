#!/bin/sh

# Print environment variables
echo "=== Environment Debug ==="
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DATABASE_URL: ${DATABASE_URL:0:30}..." # Print first 30 chars
echo "PGHOST: ${PGHOST}"
echo "REDIS_URL: ${REDIS_URL:0:30}..." # Print first 30 chars
echo "======================="

# Check if critical environment variables are set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set!"
  echo "Please ensure PostgreSQL service is linked in Railway"
  exit 1
fi

if [ -z "$REDIS_URL" ]; then
  echo "ERROR: REDIS_URL is not set!"
  echo "Please ensure Redis service is linked in Railway"
  exit 1
fi

# Wait for database to be ready
echo "Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if nc -z ${PGHOST:-localhost} ${PGPORT:-5432} 2>/dev/null; then
    echo "Database is ready!"
    break
  fi
  echo "Waiting for database at ${PGHOST}:${PGPORT}... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
  RETRY_COUNT=$((RETRY_COUNT + 1))
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "ERROR: Database connection timeout after $MAX_RETRIES attempts"
  exit 1
fi

# Generate Prisma Client
echo "Generating Prisma Client..."
pnpm prisma generate

# Run migrations
echo "Running database migrations..."
pnpm prisma migrate deploy --schema ./node_modules/@mjw324/prisma-shared/prisma/schema.prisma

# Start the application
echo "Starting application..."
if [ "$NODE_ENV" = "production" ]; then
  echo "Building application..."
  # Attempt to build the application
  if ! pnpm build; then
    echo "⛔ BUILD FAILED: TypeScript compilation errors must be fixed before the application can start."
    echo "⛔ The container will sleep to allow debugging."
    tail -f /dev/null
  fi
  # Start the compiled application only if build succeeds
  pnpm start
else
  pnpm dev
fi