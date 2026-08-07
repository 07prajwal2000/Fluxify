# ==============================================================================
# Fluxify ADMIN — the control plane.
#
# Everything you manage Fluxify with, and nothing that serves user traffic:
#
#   caddy       :8080  reverse proxy — the only port you need to publish
#   admin server:5500  control plane API, and the compiler that turns saved
#                      routes into JavaScript and publishes them to NATS KV
#   web UI      :3000  admin dashboard
#   ai-gateway  :8001  AI assistant
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
# Stage 2: build — server (standalone), web, ai-gateway. No request worker.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .

# Re-link workspace binaries — near-instant, packages are cached from deps.
RUN bun install --frozen-lockfile

# Turbo builds workspace packages + server standalone (with schema.sql) + web
# + ai-gateway.
RUN bun run build

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
      org.opencontainers.image.base.name="docker.io/oven/bun:1.3.14-alpine" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN apk add --no-cache caddy nss-tools
RUN adduser -D -s /sbin/nologin -h /app appuser

# Admin server bundle + schema.sql.
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/server
# Next.js standalone build.
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone /app/web
# AI Gateway single-file bundle + docs index.
COPY --from=build --chown=appuser:appuser /app/apps/ai-gateway/dist /app/ai-gateway

COPY --chown=appuser:appuser docker/admin/Caddyfile /app/Caddyfile
COPY --chown=appuser:appuser docker/admin/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER appuser

# 8080 is the only port you need to publish; the rest are internal.
EXPOSE 8080 5500 3000 8001

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    HOSTNAME=0.0.0.0 \
    WEB_PORT=3000 \
    SERVER_PORT=5500 \
    PROXY_PORT=8080 \
    AI_GATEWAY_PORT=8001 \
    ENABLE_ADMIN=true \
    ENABLE_BUILTIN_WORKER=false \
    ENABLE_AI=false \
    WORKER_UPSTREAM=worker:5600 \
    DOCS_INDEX_FILE_PATH=/app/ai-gateway/docs-index.bin

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:5500/_/admin/api/healthchecks/startup || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
