FROM node:20-alpine

WORKDIR /app

# Add .npmrc for registry access
COPY .npmrc .npmrc

# Install required packages
RUN apk add --no-cache netcat-openbsd

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

EXPOSE 3000

# Generate Prisma Client (using project's prisma)
RUN pnpm prisma generate --schema ./node_modules/@mjw324/prisma-shared/prisma/schema.prisma

# Make start script executable
RUN chmod +x /app/src/scripts/start.sh

CMD ["/app/src/scripts/start.sh"]