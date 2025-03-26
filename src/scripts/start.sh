#!/bin/sh

# Wait for database to be ready
echo "Waiting for database to be ready..."
while ! nc -z $POSTGRES_HOST $POSTGRES_PORT; do
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
  pnpm build

  # Start the compiled application
  pnpm start
else
  pnpm dev
fi
