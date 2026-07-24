# ==============================================================================
# Fluxify request worker — runs ONLY apps/server/deployments/worker.ts.
# A standalone, independently scalable execution node: no admin API, no web,
# no caddy. Point k8s HPA at this image.
#
# Build from the repo root (the CBE directory):
#   docker build -f docker/worker/Dockerfile -t fluxify-worker .
# Run:
#   docker run --rm -p 5600:5600 --env-file apps/server/.env fluxify-worker
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
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/blocks/package.json packages/blocks/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY scripts/setup-hooks.ts scripts/setup-hooks.ts

RUN bun install --frozen-lockfile

# ------------------------------------------------------------------------------
# Stage 2: build — bundle the worker to a single minified file (+ native assets).
# bun bundles the workspace packages from source; no turbo / full monorepo build.
# Runs in-image so native bindings (e.g. snappy) resolve to linux-musl.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .
# Re-link workspace bins (near-instant; packages cached from deps stage).
RUN bun install --frozen-lockfile
RUN bun --cwd apps/server run build:worker

# ------------------------------------------------------------------------------
# Stage 3: production — minimal runtime, no node_modules or source.
# ------------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app

# tini = PID 1 for correct SIGTERM handling (graceful k8s pod shutdown).
RUN apk add --no-cache tini

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
# No HTTP health route exists; use a TCP liveness/readiness probe on 5600.
ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "/app/worker/worker.js"]
