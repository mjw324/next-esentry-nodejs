FROM node:20-alpine

WORKDIR /app

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

# Convert line endings and make executable
RUN dos2unix /app/src/scripts/start.sh && \
    chmod +x /app/src/scripts/start.sh

CMD ["/app/src/scripts/start.sh"]