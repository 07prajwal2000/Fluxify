# ==============================================================================
# Fluxify request worker — runs ONLY apps/server/deployments/worker.ts.
# A standalone, independently scalable execution node: no admin API, no web,
# no caddy. Point k8s HPA at this image.
#
# Build from the repo root (the CBE directory):
#   docker build -f docker/worker/Dockerfile -t fluxify-worker .
# Run:
#   docker run --rm -p 5600:5600 --env-file .env fluxify-worker
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — install once, cached until any manifest/lockfile changes.
# All workspace manifests are needed so --frozen-lockfile can validate the graph.
# ------------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/ai-gateway/package.json apps/ai-gateway/package.json
COPY apps/portal/package.json apps/portal/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/blocks/package.json packages/blocks/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/components/package.json packages/components/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY scripts/setup-hooks.ts scripts/setup-hooks.ts

RUN bun install --frozen-lockfile

# ------------------------------------------------------------------------------
# Stage 2: build — bundle the worker to a single minified file (+ sourcemap).
# Copies ONLY apps/server and the four workspace packages it imports; no web,
# ai-gateway, portal, docs, or turbo full build. node_modules is inherited from
# the deps stage, so no second install. bun bundles the packages from source
# (they export ./index.ts), so nothing needs pre-building.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY packages/common packages/common
COPY packages/lib packages/lib
COPY packages/blocks packages/blocks
COPY packages/adapters packages/adapters
COPY apps/server apps/server

RUN bun run --cwd apps/server build:worker

# ------------------------------------------------------------------------------
# Stage 3: production — minimal runtime, no node_modules or source.
# ------------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app

# Non-root, no login shell.
RUN adduser -D -s /sbin/nologin -h /app appuser

# Bundled worker.js + its native assets (source map included for stack traces).
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/worker

USER appuser

EXPOSE 5600

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    WORKER_PORT=5600

# PG_URL, redis, and OTLP_* come from the deploy env (--env-file / k8s secrets).
# Probes (port 5600):
#   startup: GET /_/admin/api/healthchecks/startup  -> 200 once listening
#   ready:   GET /_/admin/api/healthchecks/ready     -> 200 only when deps loaded
ENTRYPOINT ["bun", "run", "/app/worker/worker.js"]
