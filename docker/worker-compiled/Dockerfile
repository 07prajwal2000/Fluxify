# ==============================================================================
# Fluxify COMPILED WORKER — the node that serves your API traffic.
#
# It runs your routes as pre-compiled JavaScript. Routes arrive over NATS KV
# already compiled by the admin service, so this container never opens a
# database connection and never sees your database credentials. Scale it out
# freely: it holds no state a replica could disagree about.
#
#   :5600  user API traffic
#   :5601  health and readiness — point probes and load balancers HERE
#
# One worker serves exactly ONE project (WORKER_PROJECT_ID). More projects means
# more worker services, not more replicas of one.
#
# ------------------------------------------------------------------------------
# BUILD (from the repo root, the CBE directory)
#   docker build -f docker/worker-compiled/Dockerfile -t fluxify-worker-compiled .
#
# RUN
#   docker run --rm -p 5600:5600 -p 5601:5601 \
#     -e WORKER_PROJECT_ID=<project-uuid> --env-file .env fluxify-worker-compiled
#
# ------------------------------------------------------------------------------
# REQUIRED ENVIRONMENT
#   WORKER_PROJECT_ID       the project this worker serves. The container exits
#                           immediately with a clear message if it is missing.
#   MASTER_ENCRYPTION_KEY   must MATCH the admin service — project config is
#                           delivered encrypted with it. Exits without it.
#   NATS_URL                nats://host:4222 — JetStream MUST be on (`-js`)
#   REDIS_HOST              Redis/Valkey hostname
#
# OPTIONAL
#   NATS_TOKEN              NATS auth token
#   REDIS_PORT / REDIS_USER / REDIS_PASS
#   WORKER_PORT             traffic port (default 5600)
#   WORKER_HEALTH_PORT      health port (default 5601)
#   WORKER_THREADS          execution threads (default 1) — see the note on
#                           EXPOSE below before raising this
#   OTLP_*                  log shipping; see docker/kit/env.example
#
# DELIBERATELY NOT USED
#   PG_URL and every other database setting. This container must never reach
#   the database; leave them unset, or blank them if you share one env file.
#
# ------------------------------------------------------------------------------
# PROBES (port 5601, never 5600)
#   startup:   GET /_/admin/api/healthchecks/startup  -> 200 once listening
#   readiness: GET /_/admin/api/healthchecks/ready    -> 200 once routes loaded
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — install once, cached until a manifest or the lockfile changes.
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
# Stage 2: build — TWO bundles, not one.
#
# Bun's bundler does not pull a worker thread into its parent's bundle; it
# leaves the reference and resolves it at runtime. So the supervisor and the
# execution thread are built as separate entry points and land side by side in
# dist/. compiledWorker.ts looks for ./executionThread.js next to itself, so
# this flat layout is load-bearing — do not nest the outputs.
#
# Only apps/server and the four workspace packages it imports are copied — no
# web, ai-gateway, portal or docs. node_modules is inherited from deps, and bun
# bundles the packages straight from source, so nothing needs pre-building.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY packages/common packages/common
COPY packages/lib packages/lib
COPY packages/blocks packages/blocks
COPY packages/adapters packages/adapters
COPY apps/server apps/server

RUN bun run --cwd apps/server build:worker:compiled

# ------------------------------------------------------------------------------
# Stage 3: production — minimal runtime, no node_modules or source.
# ------------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Fluxify Compiled Worker" \
      org.opencontainers.image.description="Executes Fluxify routes as pre-compiled JavaScript. Receives artifacts over NATS KV and never connects to the database." \
      org.opencontainers.image.vendor="Fluxify" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Fluxify-rest/Fluxify" \
      org.opencontainers.image.url="https://fluxify.rest" \
      org.opencontainers.image.documentation="https://fluxify.rest/deployments/" \
      org.opencontainers.image.base.name="docker.io/oven/bun:1.3.14-alpine" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Non-root, no login shell.
RUN adduser -D -s /sbin/nologin -h /app appuser

# compiledWorker.js + executionThread.js + native assets, siblings in one dir.
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/worker

USER appuser

# 5600 — user API traffic, bound by the execution thread. With WORKER_THREADS>1
#        every thread binds it via SO_REUSEPORT and the kernel picks which one
#        takes each connection; at the default of 1 thread that is a no-op.
# 5601 — health/readiness, served by the supervisor alone. Deliberately NOT on
#        5600: with SO_REUSEPORT a probe there is answered by whichever thread
#        the kernel happened to choose, so it cannot tell you the others are
#        alive. Point your probes and load-balancer health checks at 5601.
EXPOSE 5600 5601

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    WORKER_PORT=5600 \
    WORKER_HEALTH_PORT=5601

# Readiness, not liveness: 200 only once compiled routes have been loaded, so a
# worker that came up before the compiler published anything is not sent traffic.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:5601/_/admin/api/healthchecks/ready || exit 1

# Scale this deployment with replicas, not with WORKER_THREADS — see EXPOSE.
ENTRYPOINT ["bun", "run", "/app/worker/compiledWorker.js"]
