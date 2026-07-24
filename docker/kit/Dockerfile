# ==============================================================================
# Stage 1: deps — Install dependencies (cached layer)
# Only invalidated when package.json / bun.lock files change
# ==============================================================================
FROM oven/bun:1.3.14-alpine AS deps

WORKDIR /app

# Copy only package manifests + lockfile for maximum cache reuse
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
# Stage 2: build — Compile all services
# ==============================================================================
FROM deps AS build

WORKDIR /app

# Copy full source (deps already installed from stage 1)
COPY . .

# Re-link workspace binaries — near-instant since packages are cached from deps stage.
# Required because turbo sub-package builds need per-workspace .bin symlinks.
RUN bun install --frozen-lockfile

# Build all workspace packages + server + web (via turbo)
RUN bun run build

# Prepare Next.js standalone output
WORKDIR /app/apps/web
RUN cp -r public .next/standalone/apps/web/public && \
    cp -r .next/static .next/standalone/apps/web/.next/static

# Build ai-gateway and gather docs index
WORKDIR /app/apps/ai-gateway
RUN bun run gather

# ==============================================================================
# Stage 3: production — Minimal runtime image
# ==============================================================================
FROM oven/bun:1.3.14-alpine AS production

WORKDIR /app

# Install only tini for init process management
RUN apk add --no-cache tini caddy nss-tools

# Create non-root user with no login shell
RUN adduser -D -s /sbin/nologin -h /app appuser

# --- Copy built artifacts with correct ownership ---

# Server: standalone bundle + docs index + schema
COPY --from=build --chown=appuser:appuser /app/apps/server/dist /app/server

# Web: Next.js standalone build
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone /app/web

# AI Gateway: minified single-file bundle
COPY --from=build --chown=appuser:appuser /app/apps/ai-gateway/dist /app/ai-gateway

# Caddy config
COPY --chown=appuser:appuser docker/kit/Caddyfile /app/Caddyfile

# Copy entrypoint script
COPY --chown=appuser:appuser docker/kit/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Switch to non-root user
USER appuser

# Ports: proxy (8080), server (5500), web (3000), ai-gateway (8001)
EXPOSE 8080 5500 3000 8001

# --- Environment defaults ---
ENV NODE_ENV=production \
    ENVIRONMENT=production \
    HOSTNAME=0.0.0.0 \
    WEB_PORT=3000 \
    SERVER_PORT=5500 \
    PROXY_PORT=8080 \
    AI_GATEWAY_PORT=8001 \
    ENABLE_AI=false

# tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
