#!/bin/sh

# Wait for database to be ready
echo "Waiting for database to be ready..."

# Use POSTGRES_HOST from Railway environment variable
# Railway provides PGHOST automatically when you link services
while ! nc -z ${PGHOST:-$POSTGRES_HOST} ${PGPORT:-5432}; do
  echo "Waiting for database at ${PGHOST:-$POSTGRES_HOST}:${PGPORT:-5432}..."
  sleep 1
done

echo "Database is ready!"

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
    echo "⛔ The container will sleep."
    echo "⛔ Fix the TypeScript errors and redeploy the application."
    # Sleep forever to prevent container restart loop
    # This allows inspection of the container or logs
    tail -f /dev/null
  fi
  # Start the compiled application only if build succeeds
  pnpm start
else
  pnpm dev
fi