# syntax=docker/dockerfile:1

# pnpm is pinned. An unpinned `npm install -g pnpm` now resolves to pnpm 12,
# whose frozen install exits 1 on the dependency build scripts it skips
# (ERR_PNPM_IGNORED_BUILDS: @prisma/client, @prisma/engines, msgpackr-extract,
# prisma), so every build failed. pnpm-lock.yaml is lockfileVersion 9.0, which
# pnpm 9 and 10 read; 10.x installs it with a warning and exit 0. Bump this and
# the lockfile together.
ARG PNPM_VERSION=10.34.6

# ---------------------------------------------------------------------------
# Stage 1: dependencies (full, including devDependencies) + Prisma client
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps

ARG PNPM_VERSION

WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION}

COPY package.json pnpm-lock.yaml ./

# Full install so the build stage has typescript/@types available.
# `prisma generate` runs here (postinstall) instead of at container start.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: compile TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

ARG PNPM_VERSION

WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION}

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

# A compilation error must fail the image build, not the container start.
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: runtime — production dependencies only
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

ARG PNPM_VERSION

WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g pnpm@${PNPM_VERSION}

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
