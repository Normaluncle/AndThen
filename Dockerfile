# syntax=docker/dockerfile:1

# ---------- base ----------
FROM node:24-alpine AS base
# Keep corepack on the same registry as .npmrc so the pnpm download is reliable.
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}"
RUN corepack enable
WORKDIR /app

# ---------- dependencies (full, for build) ----------
FROM base AS deps
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --reporter=append-only

# ---------- build (TypeScript -> dist) ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---------- production dependencies only ----------
FROM base AS prod-deps
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --reporter=append-only

# ---------- runtime ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Migrations are read from the filesystem at runtime by src/db/migrate.ts.
COPY src/db/migrations ./src/db/migrations

USER app
EXPOSE 8080

# Overridden per service: `node dist/server.js` / `node dist/worker.js` /
# `node dist/db/migrate.js`.
CMD ["node", "dist/server.js"]
