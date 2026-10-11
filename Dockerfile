FROM node:20-alpine

WORKDIR /app

# Install required packages
RUN apk add --no-cache netcat-openbsd dos2unix

# Install pnpm (pinned: lockfile v9; pnpm >= 11 fails the frozen install with ERR_PNPM_IGNORED_BUILDS)
RUN npm install -g pnpm@10.34.6

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma Client during build
RUN pnpm prisma generate

# Make start script executable
RUN dos2unix /app/src/scripts/start.sh && \
    chmod +x /app/src/scripts/start.sh

EXPOSE 3000

CMD ["/app/src/scripts/start.sh"]