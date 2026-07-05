---
title: Self-Hosting Fluxify
description: Deploy Fluxify on your own infrastructure using Docker. Covers architecture, requirements, setup, upgrading, and troubleshooting.
---

# Self-Hosting Fluxify

Fluxify is designed to be self-hosted. This guide covers everything you need to run Fluxify on your own infrastructure using the official `fluxify-kit` Docker image — a batteries-included image that bundles all application components into a single deployable container.

> [!NOTE]
> This guide covers the **standalone Docker** deployment — the simplest way to self-host Fluxify. Production-grade topologies (Kubernetes, cloud-managed services) will be documented here as they mature.

---

## Architecture Overview

The topology below reflects the standalone Docker deployment. External clients talk to port `8080` only — Caddy routes requests internally.

```
Browser / API Client
        │  HTTP Request
        ▼
   Caddy Proxy :8080  ◄── single exposed port
        │
        ├─► Frontend (Next.js) :3000     ← Visual workflow editor
        │
        └─► Backend API & Worker :5500   ← Execution engine + REST API
                    │
                    ├─► PostgreSQL       ← Workflows, users, project data
                    ├─► Redis            ← Caching, BullMQ queues, pub/sub
                    └─► AI Gateway :8001 ← LLM proxy (work in progress)
```

The `fluxify-kit` image contains all application components in a single container, managed internally:

| Component | Internal Port | Description |
| :--- | :--- | :--- |
| **Caddy Proxy** | `8080` (exposed) | Reverse proxy routing all traffic to internal services |
| **Frontend** (Next.js) | `3000` (internal) | Visual workflow editor |
| **Backend API & Worker** | `5500` (internal) | Execution engine, REST API, and background jobs |
| **AI Gateway** | `8001` (internal) | LLM integration proxy *(work in progress — shipped but not yet connected)* |

In addition to the container, the following **external services** are required and must be provisioned separately:

- **PostgreSQL** — primary datastore for workflows, users, and project configuration
- **Redis** — used for caching, BullMQ job queues, and pub/sub

---

## Requirements

- **Docker** (Docker Engine 20+ or Docker Desktop)
- A **PostgreSQL** instance (version 14+ recommended)
- A **Redis** instance (version 6+ recommended)
- A domain name or IP address reachable from your users (for production)

---

## Setup Guide

### Step 1: Pull the Image

```bash
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
```

### Step 2: Prepare the Environment File

Create a `.env` file with your configuration. Use the template in [Environment Variables](#environment-variables) at the bottom of this page as a reference.

The minimum required values for a functional deployment are:

```env
ENVIRONMENT=production
NODE_ENV=production

PG_URL=postgres://user:password@your-db-host:5432/fluxify

REDIS_HOST=your-redis-host
REDIS_PORT=6379

HOSTNAME=your-domain.com
SERVER_URL=https://your-domain.com

BETTER_AUTH_SECRET=<generate a random secret>
BETTER_AUTH_URL=https://your-domain.com
SYSTEM_ACCESS_KEY=<generate a random secret>
MASTER_ENCRYPTION_KEY=<generate with: openssl rand -base64 32>

SEED_USER_EMAIL=admin@your-domain.com
SEED_USER_PASSWORD=<strong-password>
SEED_USER_NAME=Admin
```

> [!IMPORTANT]
> **Admin user creation**: The `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` values are used to create the initial admin account on **first run only**. If these are not set before the first startup, you will not be able to log in. The password can be changed later from the admin panel.

> [!CAUTION]
> **Change the default `MASTER_ENCRYPTION_KEY`**: The example key in the template is a placeholder. Generate your own with:
> ```bash
> openssl rand -base64 32
> ```
> Losing this key after data has been stored will make encrypted data unrecoverable.

### Step 3: Run the Container

**Option A — Manual Docker Run:**

```bash
docker run -d \
  --name fluxify \
  --env-file .env \
  -p 8080:8080 \
  --restart unless-stopped \
  ghcr.io/fluxify-rest/fluxify-kit:latest
```

**Option B — Docker Compose (Recommended):**

```yaml
# coming soon
```

> [!NOTE]
> A full Docker Compose file with PostgreSQL and Redis included is coming soon. In the meantime, provision your own PostgreSQL and Redis and use Option A above.

### Step 4: Verify the Deployment

After the container starts, the server will:
1. Run database migrations automatically.
2. Create the seed admin user (if not already created).
3. Start the Caddy proxy and all internal services.

Access the dashboard at `http://your-host:8080` (or your configured domain). Log in with the `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` from your `.env`.

---

## Upgrading

To upgrade to the latest version of Fluxify:

```bash
# Pull the latest image
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest

# Stop and remove the running container
docker stop fluxify
docker rm fluxify

# Start a fresh container with the new image
docker run -d \
  --name fluxify \
  --env-file .env \
  -p 8080:8080 \
  --restart unless-stopped \
  ghcr.io/fluxify-rest/fluxify-kit:latest
```

> [!NOTE]
> Database migrations are applied automatically on startup. Always read the release notes before upgrading to check for breaking changes.

---

## Troubleshooting

**Container exits immediately**
- Run `docker logs fluxify` to see the startup error.
- Common causes: missing required environment variables (`PG_URL`, `BETTER_AUTH_SECRET`), unreachable PostgreSQL or Redis.

**Cannot log in after first run**
- Ensure `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` were set **before** the very first container start.
- If they were not set, drop and recreate the database, then restart the container.

**Database connection errors**
- Verify `PG_URL` is correct and the PostgreSQL instance is reachable from the container.
- If running PostgreSQL on the same host, use the host's Docker bridge IP (e.g., `172.17.0.1`) or `host.docker.internal` (on Mac/Windows).

**Redis connection errors**
- Check `REDIS_HOST` and `REDIS_PORT` values.
- Ensure the Redis instance is reachable from the container.

**Port 8080 already in use**
- Change the host-side port mapping: `-p 9090:8080` (to expose on `9090` instead).
- Update `SERVER_URL` to match the new external address.

> [!TIP]
> Help us build out this section. If you encountered and solved an issue not listed here, please open a PR to add it to the docs!

---

## Environment Variables

Copy `env.example` to `.env` and configure the variables below. All values are described with their purpose and defaults.

```env
#====================== ENVIRONMENT ======================
# Application environment: development | production
ENVIRONMENT=production
NODE_ENV=production


#====================== DATABASES ======================
# PostgreSQL connection string
# Format: postgres://{username}:{password}@{host}:{port}/{database}
PG_URL=

# Redis connection details
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USER=
REDIS_PASS=


#====================== PORT CONFIG ======================
# Next.js frontend port (internal)
WEB_PORT=3000
# Main backend API & worker port (internal)
SERVER_PORT=5500
# Caddy reverse proxy port (externally exposed)
PROXY_PORT=8080
# AI Gateway port (internal, work in progress)
AI_GATEWAY_PORT=8001

# The fully-qualified domain name or IP of your deployment.
# Used for internal routing and auth. In production, set this to your FQDN.
HOSTNAME=localhost
# The public-facing base URL of your deployment (must match BETTER_AUTH_URL)
SERVER_URL=http://localhost:8080


#====================== SECURITY ======================
# Set to true to enable the admin panel on this instance.
# Set to false if running this instance as a worker-only node.
ENABLE_ADMIN=true

# 32-byte base64 encryption key used for cryptographic operations.
# Generate with: openssl rand -base64 32
# WARNING: Do not lose this key — encrypted data cannot be recovered without it.
MASTER_ENCRYPTION_KEY=ZlhiQmhaS3JSeG5qTDZoWlZMbTd1WDE3aFhvYVlUVjE=

# Enable hot-reloading of routes when a workflow is saved.
# Recommended: true (disable only if causing instability in your deployment).
HOT_RELOAD_ROUTES=true

# Secret key for Better Auth session management.
# Generate a random string, e.g.: openssl rand -hex 32
BETTER_AUTH_SECRET=

# Public-facing base URL used by Better Auth for OAuth callbacks and tokens.
# Must match SERVER_URL in production.
BETTER_AUTH_URL=

# Secret key for machine-to-machine (M2M) API communication between services.
SYSTEM_ACCESS_KEY=

# Reserved — not yet implemented. Can be omitted.
DISABLE_NPM=true

# Initial admin user created on first run.
# These values are only used once. The password can be changed later.
SEED_USER_EMAIL=admin@company.com
SEED_USER_PASSWORD=admin123
SEED_USER_NAME=Admin user


#====================== PATHS ======================
# Path to the search index binary file (used for built-in docs search).
DOCS_INDEX_FILE_PATH=docs-index.bin


#====================== OPEN TELEMETRY ======================
# OTLP endpoint to ship logs to (e.g., https://logs.example.com/v1/logs)
OTLP_LOGS_ENDPOINT=

# HTTP header name for authenticating with the OTLP endpoint
# Example: Authorization
OTLP_AUTH_HEADER_NAME=

# HTTP header value corresponding to OTLP_AUTH_HEADER_NAME
# Example: Bearer eyJhbGci...
# OTLP_AUTH_HEADER_VALUE=

# Enable or disable the OTLP logger transport
OTLP_LOGGER_ENABLED=true

# Minimum log level to ship via OTLP: info | warn | error
# Use info to capture all telemetry; use warn or error to reduce volume.
OTLP_LOGGER_LEVEL=info
```
