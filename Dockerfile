# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: dependencies (full, including devDependencies) + Prisma client
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

# Full install so the build stage has typescript/@types available.
# `prisma generate` runs here (postinstall) instead of at container start.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: compile TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

# A compilation error must fail the image build, not the container start.
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: runtime — production dependencies only
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

# Production dependencies only: the TypeScript toolchain, ESLint and Prettier
# stay out of the runtime image. The postinstall hook regenerates the Prisma
# client against this stage's node_modules.
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY src/scripts/start.sh ./src/scripts/start.sh

RUN chmod +x /app/src/scripts/start.sh

EXPOSE 3000

CMD ["/app/src/scripts/start.sh"]
