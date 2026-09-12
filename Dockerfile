# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# Base image is pinned by digest, not by the floating `24-alpine` tag, so a
# rebuild cannot silently pick up a different Node. Update the digest
# deliberately and re-run the test suite.
ARG NODE_IMAGE=node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81

# ---------- base ----------
FROM ${NODE_IMAGE} AS base
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
FROM ${NODE_IMAGE} AS runtime
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
