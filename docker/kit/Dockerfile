# ==============================================================================
# Fluxify KIT — the whole platform in ONE container.
#
# Bundles every service behind a single port so you can try Fluxify, demo it, or
# run it on a small VPS without wiring a stack together:
#
#   caddy           :8080  reverse proxy — the only port you need to publish
#   admin server    :5500  control plane API + the compiler
#   web UI          :3000  admin dashboard
#   ai-gateway      :8001  AI assistant
#   compiled worker :5600  serves your API traffic from compiled JavaScript
#                   :5601  worker health/readiness
#
# For anything with real traffic use docker/admin/Dockerfile plus
# docker/worker-compiled/Dockerfile instead, so workers scale on their own.
#
# ------------------------------------------------------------------------------
# BUILD (from the repo root, the CBE directory)
#   docker build -f docker/kit/Dockerfile -t fluxify-kit .
#
# RUN
#   docker run --rm -p 8080:8080 --env-file docker/kit/.env fluxify-kit
#
# Then open http://localhost:8080/_/admin/ui
#
# ------------------------------------------------------------------------------
# REQUIRED ENVIRONMENT
#   PG_URL                  postgres://user:pass@host:5432/fluxify
#   REDIS_HOST              Redis/Valkey hostname
#   NATS_URL                nats://host:4222  — JetStream MUST be on (`-js`)
#   MASTER_ENCRYPTION_KEY   `openssl rand -base64 32`; encrypts project config
#   BETTER_AUTH_SECRET      session signing secret
#   SERVER_URL              public URL, e.g. http://localhost:8080
#   BETTER_AUTH_URL         same as SERVER_URL
#   TRUSTED_ORIGINS         comma-separated allowed origins
#
# REQUIRED ONCE YOU HAVE A PROJECT
#   WORKER_PROJECT_ID       the project this kit serves. Leave it unset on the
#                           very first boot — there is no project yet. The kit
#                           starts without the worker, you create a project in
#                           the UI, then set this and restart.
#
# OPTIONAL
#   NATS_TOKEN              NATS auth token
#   ENABLE_AI               "true" to enable the AI assistant (default false)
#   INTEGRATION_TIMEOUT_POLICY_IN_SEC
#                           idle database-integration timeout (default 450 / 7.5 minutes)
#   ASYNC_EXECUTOR_MAX_IN_FLIGHT / ASYNC_EXECUTOR_MAX_QUEUE_DEPTH
#                           bounded local async-trigger capacity (defaults 10 / 100)
#   ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS
#                           graceful drain deadline (default 30000)
#   PROXY_PORT              published port (default 8080)
#   SEED_USER_EMAIL / SEED_USER_PASSWORD / SEED_USER_NAME
#                           first admin account created on an empty database
#
# See docker/kit/env.example for the complete annotated list.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — install once, cached until a manifest or the lockfile changes.
# All workspace manifests are copied so --frozen-lockfile can validate the graph.
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
# Stage 2: build — every service.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .

# Re-link workspace binaries — near-instant since packages are cached from deps.
# Required because turbo sub-package builds need per-workspace .bin symlinks.
RUN bun install --frozen-lockfile

# Workspace packages + admin server (standalone.js + schema.sql) + web + gateway.
RUN bun run build

# The compiled worker is TWO bundles, not one. Bun's bundler does not pull a
# child-process entry point into its parent's bundle; it leaves the reference and resolves
# it at runtime. compiledWorker.js looks for ./executionProcess.js beside itself,
# so this flat sibling layout in dist/ is load-bearing — do not nest it.
RUN bun run --cwd apps/server build:worker:compiled

# Next.js standalone output does not include these; copy them in.
WORKDIR /app/apps/web
RUN cp -r public .next/standalone/apps/web/public && \
    cp -r .next/static .next/standalone/apps/web/.next/static

# AI Gateway documentation search index.
WORKDIR /app/apps/ai-gateway
RUN bun run gather

# ------------------------------------------------------------------------------
# Stage 3: production — runtime only, no sources and no node_modules.
# ------------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app

# Build metadata, passed by CI: --build-arg VERSION=... --build-arg VCS_REF=...
ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Fluxify Kit" \
      org.opencontainers.image.description="All-in-one Fluxify: admin API, compiler, web UI, AI gateway and compiled request worker behind a single proxy port." \
      org.opencontainers.image.vendor="Fluxify" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Fluxify-rest/Fluxify" \
      org.opencontainers.image.url="https://fluxify.rest" \
      org.opencontainers.image.documentation="https://fluxify.rest/deployments/" \
      org.opencontainers.image.base.name="docker.io/oven/bun:1.3.14-alpine" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# tini reaps the child processes the entrypoint spawns; caddy is the proxy.
RUN apk add --no-cache tini caddy nss-tools

RUN adduser -D -s /sbin/nologin -h /app appuser

# Admin server bundle + compiled worker bundles + schema.sql, all siblings.
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/server
# Next.js standalone build.
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone /app/web
# AI Gateway single-file bundle + docs index.
COPY --from=build --chown=appuser:appuser /app/apps/ai-gateway/dist /app/ai-gateway

COPY --chown=appuser:appuser docker/kit/Caddyfile /app/Caddyfile
COPY --chown=appuser:appuser docker/kit/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER appuser

# 8080 is the only port you need to publish; the rest are internal.
EXPOSE 8080 5500 5600 5601 3000 8001

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    HOSTNAME=0.0.0.0 \
    WEB_PORT=3000 \
    SERVER_PORT=5500 \
    WORKER_PORT=5600 \
    WORKER_HEALTH_PORT=5601 \
    INTEGRATION_TIMEOUT_POLICY_IN_SEC=450 \
    ASYNC_EXECUTOR_MAX_IN_FLIGHT=10 \
    ASYNC_EXECUTOR_MAX_QUEUE_DEPTH=100 \
    ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS=30000 \
    PROXY_PORT=8080 \
    AI_GATEWAY_PORT=8001 \
    ENABLE_ADMIN=true \
    ENABLE_BUILTIN_WORKER=false \
    ENABLE_AI=false \
    DOCS_INDEX_FILE_PATH=/app/ai-gateway/docs-index.bin

# Reports healthy once the admin API answers; the worker has its own probe on
# 5601 because it may legitimately be absent (see WORKER_PROJECT_ID above).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:5500/_/admin/api/healthchecks/startup || exit 1

# tini as PID 1 so signals reach every service and nothing is orphaned.
ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
