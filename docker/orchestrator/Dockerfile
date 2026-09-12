# ==============================================================================
# Fluxify ORCHESTRATOR — the process that decides which worker nodes exist.
#
# It reads the claims an operator wrote, works out which worker containers
# should be running, and creates or removes containers on the Docker host until
# reality agrees. Nobody runs `docker run` for a worker.
#
#   :5800  health and readiness
#
# It touches ONLY containers labelled `fluxify.managed-by=orchestrator`. A
# hand-started worker, or anything else on the host, is invisible to it — the
# daemon applies that filter, not this process.
#
# ------------------------------------------------------------------------------
# BUILD (from the repo root, the CBE directory)
#   docker build -f docker/orchestrator/Dockerfile -t fluxify-orchestrator .
#
# RUN
#   docker run --rm -p 5800:5800 --env-file .env \
#     -e ORCHESTRATOR_WORKER_IMAGE=fluxify-worker-compiled:latest \
#     -v /var/run/docker.sock:/var/run/docker.sock fluxify-orchestrator
#
# ------------------------------------------------------------------------------
# REQUIRED ENVIRONMENT
#   ORCHESTRATOR_WORKER_IMAGE  the ONLY image this process may create a
#                              container from. This is the image allowlist, so
#                              no image name can ever arrive from a database
#                              row. Exits immediately without it.
#   PG_URL                     control-plane database. Unlike a worker, this IS
#                              a control-plane component and reads claims, the
#                              pool ceiling and trigger groups directly.
#   NATS_URL                   nats://host:4222 — JetStream MUST be on (`-js`)
#   MASTER_ENCRYPTION_KEY      not used here, but passed down to the workers it
#                              creates, which need it to read config artifacts
#
# OPTIONAL
#   DOCKER_HOST                unix:///var/run/docker.sock (default), or
#                              tcp://host:port. A Windows named pipe cannot be
#                              opened — on Docker Desktop expose the daemon on
#                              tcp://localhost:2375 for local runs.
#   ORCHESTRATOR_NETWORK       network worker containers join (default
#                              fluxify_net). Must be the one Traefik and NATS
#                              are on, or the nodes it creates serve nothing.
#   ORCHESTRATOR_HEALTH_PORT   default 5800
#   ORCHESTRATOR_RECONCILE_INTERVAL_MS
#                              default 5000, and also the leader renewal rate
#   NATS_TOKEN / REDIS_*       passed through to the workers it creates
#
# ------------------------------------------------------------------------------
# WHY THIS IMAGE IS NOT DISTROLESS, AND WHY IT RUNS AS ROOT
#
# It needs the Docker socket, which is root-owned on the host and root:root
# inside Docker Desktop's VM. A distroless `USER nonroot` cannot read it, and
# the group id that could is different on every host — `group_add` would have
# to be edited per deployment. So: alpine, as root, deliberately.
#
# This costs less than it looks. The socket is root-equivalent on the host
# already, so a compromise of this process is host compromise whatever user it
# runs as; dropping to a non-root user that can still write the socket would be
# hardening in appearance only. What actually contains the damage is the narrow
# command vocabulary — see `containerSpec.ts`: the image comes from the
# environment, ids are validated before they become labels or env, and no
# user-supplied string ever reaches container create.
#
# It runs NO user-authored code. That is what the worker image is for, and that
# one is distroless and unprivileged precisely because it does.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: deps — install once, cached until a manifest or the lockfile changes.
# All workspace manifests are needed so --frozen-lockfile can validate the graph.
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
# Stage 2: build — one bundle. No child process to build separately, unlike the
# worker: this process spawns containers, not code.
# ------------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY packages/common packages/common
COPY packages/lib packages/lib
COPY packages/blocks packages/blocks
COPY packages/adapters packages/adapters
COPY apps/server apps/server

RUN bun run --cwd apps/server build:orchestrator

# ------------------------------------------------------------------------------
# Stage 3: production
# ------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS production
WORKDIR /app

ARG BUN_VERSION
ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Fluxify Orchestrator" \
      org.opencontainers.image.description="Reconciles Fluxify worker containers against the node claims an operator wrote. Holds the Docker socket; runs no user code." \
      org.opencontainers.image.vendor="Fluxify" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Fluxify-rest/Fluxify" \
      org.opencontainers.image.url="https://fluxify.rest" \
      org.opencontainers.image.documentation="https://fluxify.rest/deployments/" \
      org.opencontainers.image.base.name="docker.io/oven/bun:${BUN_VERSION}-alpine" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

COPY --from=build /app/apps/server/dist /app/orchestrator
# Read from the working directory by bun: no runtime auto-install.
COPY docker/bunfig.toml /app/bunfig.toml

EXPOSE 5800

ENV NODE_ENV=production \
    ENVIRONMENT=production \
    ORCHESTRATOR_HEALTH_PORT=5800

# Readiness is NATS plus a reachable daemon — without either, this process can
# neither see desired state nor act on it.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["/usr/local/bin/bun", "-e", "fetch('http://localhost:5800/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/bun", "run", "/app/orchestrator/orchestrator.js"]
