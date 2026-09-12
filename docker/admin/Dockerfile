# ==============================================================================
# Fluxify ADMIN — the control plane.
#
# Everything you manage Fluxify with, and nothing that serves user traffic:
#
#   caddy       :8080  reverse proxy — the only port you need to publish
#   admin server:5500  control plane API, and the compiler that turns saved
#                      routes into JavaScript and publishes them to NATS KV
#   admin UI           static Vite bundle (apps/portal) served by caddy
#   ai-gateway  :8001  AI assistant and the MCP server (/_/admin/mcp)
#
# User API traffic is NOT served here. Run docker/worker-compiled/Dockerfile for
# that and point WORKER_UPSTREAM at it, or let an edge proxy route to it
# directly (see docker/production/docker-compose.yml, which uses Traefik).
#
# Want one container instead of two? Use docker/kit/Dockerfile.
#
# ------------------------------------------------------------------------------
# BUILD (from the repo root, the CBE directory)
#   docker build -f docker/admin/Dockerfile -t fluxify-admin .
#
# RUN
#   docker run --rm -p 8080:8080 --env-file .env \
#     --ulimit nofile=4096:8192 -m 2g fluxify-admin
#
#   The limits are not optional extras: test suites run user-authored code in
#   child processes of this container. They cannot live in this Dockerfile —
#   ulimits and memory are runtime settings. See docker/production/
#   docker-compose.yml for the composed equivalent.
#
# ------------------------------------------------------------------------------
# REQUIRED ENVIRONMENT
#   PG_URL                  postgres://user:pass@host:5432/fluxify — this is the
#                           only service that talks to the database
#   REDIS_HOST              Redis/Valkey hostname
#   NATS_URL                nats://host:4222 — JetStream MUST be on (`-js`); the
#                           compile queue and artifact bucket both need it
#   MASTER_ENCRYPTION_KEY   `openssl rand -base64 32`. Workers need the SAME key
#                           — project config travels to them encrypted with it
#   BETTER_AUTH_SECRET      session signing secret
#   SERVER_URL              public URL, e.g. https://admin.example.com
#   BETTER_AUTH_URL         same as SERVER_URL
#   TRUSTED_ORIGINS         comma-separated allowed origins
#
# OPTIONAL
#   WORKER_UPSTREAM         host:port of a worker to proxy user traffic to
#                           (default worker:5600). Ignored when an edge proxy
#                           routes to workers itself.
#   NATS_TOKEN              NATS auth token
#   ENABLE_AI               "true" to enable the AI assistant (default false)
#   PROXY_PORT              published port (default 8080)
#   SEED_USER_EMAIL / SEED_USER_PASSWORD / SEED_USER_NAME
#                           first admin account created on an empty database
#
# See docker/kit/env.example for the complete annotated list.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — install once, cached until a manifest or the lockfile changes.
# ------------------------------------------------------------------------------
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-alpine AS deps
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
COPY testing/e2e/package.json testing/e2e/package.json
COPY scripts/setup-hooks.ts scripts/setup-hooks.ts

RUN bun install --frozen-lockfile

# ------------------------------------------------------------------------------
# Stage 2: build — server (standalone), telemetry worker, portal, ai-gateway.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .

# Re-link workspace binaries — near-instant, packages are cached from deps.
RUN bun install --frozen-lockfile

# Workspace packages + server standalone (with schema.sql) + portal + gateway.
# --filter excludes @fluxify/web: the legacy Next.js app is not shipped.
RUN bun run build --filter=!@fluxify/web

# Telemetry is control-plane work: it resolves project destinations and exports
# completed route runs without giving those credentials to execution processes.
RUN bun run --cwd apps/server build:worker:telemetry

# AI Gateway documentation search index.
WORKDIR /app/apps/ai-gateway
RUN bun run gather

# ------------------------------------------------------------------------------
# Stage 3: production — runtime only, no sources and no node_modules.
# ------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS production
WORKDIR /app

ARG BUN_VERSION
ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Fluxify Admin" \
      org.opencontainers.image.description="Fluxify control plane: admin API, graph compiler, web dashboard and AI gateway. Serves no user API traffic." \
      org.opencontainers.image.vendor="Fluxify" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Fluxify-rest/Fluxify" \
      org.opencontainers.image.url="https://fluxify.rest" \
      org.opencontainers.image.documentation="https://fluxify.rest/deployments/" \
      org.opencontainers.image.base.name="docker.io/oven/bun:${BUN_VERSION}-alpine" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# tini reaps the child processes (services, test-suite runs); caddy is the proxy.
RUN apk add --no-cache tini caddy nss-tools
RUN adduser -D -s /sbin/nologin -h /app appuser

# Admin server bundle + schema.sql.
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/server
# Kafka's compression wasm, loaded from "../dist/native.wasm" relative to the
# bundle — i.e. /app/dist. Without it, testing a Kafka integration connection
# and creating topics for a Kafka trigger both fail.
COPY --from=build --chown=appuser:appuser /app/apps/server/dist/native.wasm /app/dist/native.wasm
# Services run with --cwd=/app/server, where bun reads this: no runtime
# auto-install. See the file for why that crashes an image without node_modules.
COPY --chown=appuser:appuser docker/bunfig.toml /app/server/bunfig.toml
# Admin UI — a static Vite bundle, served directly by Caddy. No Node process.
COPY --from=build --chown=appuser:appuser /app/apps/portal/dist /app/portal
# AI Gateway single-file bundle + docs index.
COPY --from=build --chown=appuser:appuser /app/apps/ai-gateway/dist /app/ai-gateway

COPY --chown=appuser:appuser docker/admin/Caddyfile /app/Caddyfile
COPY --chown=appuser:appuser docker/admin/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER appuser

# 8080 is the only port you need to publish; the rest are internal.
EXPOSE 8080 5500 8001

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    HOSTNAME=0.0.0.0 \
    SERVER_PORT=5500 \
    PROXY_PORT=8080 \
    AI_GATEWAY_PORT=8001 \
    ENABLE_ADMIN=true \
    ENABLE_BUILTIN_WORKER=false \
    ENABLE_AI=false \
    WORKER_UPSTREAM=worker:5600 \
    DOCS_INDEX_FILE_PATH=/app/ai-gateway/docs-index.bin

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:5500/_/admin/api/public-settings || exit 1

# tini as PID 1 so signals reach every service and nothing is orphaned.
ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
