# ==============================================================================
# Fluxify admin (control plane) — server + web + ai-gateway + caddy proxy.
# No request worker: user API traffic is proxied to a separate worker service
# (WORKER_UPSTREAM). Run the worker from docker/worker/Dockerfile.
#
# Build from the repo root (the CBE directory):
#   docker build -f docker/admin/Dockerfile -t fluxify-admin .
# ==============================================================================

# ==============================================================================
# Stage 1: deps — install dependencies (cached until manifests/lockfile change)
# ==============================================================================
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

# ==============================================================================
# Stage 2: build — compile server (standalone), web, and ai-gateway
# ==============================================================================
FROM deps AS build
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

# Turbo builds server standalone + web + workspace packages + ai-gateway.
RUN bun run build

# Next.js standalone output needs public/ and static assets copied in.
WORKDIR /app/apps/web
RUN cp -r public .next/standalone/apps/web/public && \
    cp -r .next/static .next/standalone/apps/web/.next/static

# AI Gateway docs index.
WORKDIR /app/apps/ai-gateway
RUN bun run gather

# ==============================================================================
# Stage 3: production — minimal runtime image
# ==============================================================================
FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app

RUN apk add --no-cache caddy nss-tools
RUN adduser -D -s /sbin/nologin -h /app appuser

# Server: standalone bundle + docs index + schema
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/server
# Web: Next.js standalone build
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone /app/web
# AI Gateway: minified single-file bundle
COPY --from=build --chown=appuser:appuser /app/apps/ai-gateway/dist /app/ai-gateway

COPY --chown=appuser:appuser docker/admin/Caddyfile /app/Caddyfile
COPY --chown=appuser:appuser docker/admin/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER appuser

# Ports: proxy (8080), server (5500), web (3000), ai-gateway (8001)
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
    WORKER_UPSTREAM=worker:5600 \
    ENABLE_AI=false

ENTRYPOINT ["/app/entrypoint.sh"]
