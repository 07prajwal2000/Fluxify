---
title: Self-Hosting Fluxify
description: Complete self-hosting deployment guide for Fluxify — Docker Compose stack with PostgreSQL & Redis dependencies, environment setup, secret key generation, and troubleshooting.
---

# Self-Hosting Fluxify

Fluxify is engineered for seamless self-hosting. This guide covers everything you need to run Fluxify on your own infrastructure using the official `fluxify-kit` Docker image — a batteries-included bundle containing all core microservices — alongside its required PostgreSQL and Redis infrastructure dependencies.

> [!WARNING]
> **Alpha Development Notice:** Fluxify is currently in **active alpha development**. While functional for self-hosted trials and evaluation, features and internal schemas may change between versions. Please review release notes before upgrading production instances.

> [!NOTE]
> This guide is structured for both **new developers** running local self-hosted trials and **experienced operators** deploying production instances.

---

## 🏗️ Architecture & Service Topology

Fluxify consists of the main application container (`fluxify-kit`) and two external datastore dependencies (PostgreSQL and Redis/Valkey). Traffic enters through Caddy on port `8080`.

```
Browser / API Client
        │  HTTP Request
        ▼
   Caddy Proxy :8080  ◄── Single exposed public port
        │
        ├─► Frontend (Next.js) :3000     ← Visual workflow editor
        ├─► Backend API & Worker :5500   ← Execution engine + REST API
        └─► AI Gateway :8001             ← LLM proxy (WIP)
                    │
                    ├─► PostgreSQL :5432 ← Workflows, users, project data
                    └─► Valkey/Redis :6379 ← Caching, BullMQ queues, pub/sub
```

### Core Components Summary

| Component | Port | Type | Purpose |
| :--- | :--- | :--- | :--- |
| **`fluxify-kit`** | `8080` (exposed) | Application | Bundles Caddy, Next.js UI (`:3000`), Server API (`:5500`), & AI Gateway (`:8001`) |
| **PostgreSQL** | `5432` (internal) | Datastore | Primary relational database for workflows, project configuration, and auth users |
| **Valkey / Redis** | `6379` (internal) | Cache / Queue | In-memory datastore for caching, live signals, and background queue workers |

---

## 🛠️ System Requirements

| Resource | Minimum (Local / Trial) | Recommended (Production) |
| :--- | :--- | :--- |
| **CPU** | 1 Core | 2+ Cores |
| **RAM** | 2 GB | 4 GB+ |
| **Disk Space** | 5 GB | 20 GB+ SSD |
| **Docker** | Engine 20.10+ or Desktop | Engine 20.10+ |

---

## 🚀 Quickstart Deployment Guide

### Step 1: Pull Official Container Image

```bash
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
```

---

### Step 2: Prepare Environment File (`.env`)

Create a `.env` file in your deployment directory. Populate required variables for database access, authentication, and cryptography.

#### Interactive Secret Key Generator

Use the interactive generator below to generate secure keys for `MASTER_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and `SYSTEM_ACCESS_KEY`:

<KeyGenerator />

#### Production `.env` Template

```env
#====================== ENVIRONMENT ======================
ENVIRONMENT=production
NODE_ENV=production

#====================== DATABASES ======================
# PostgreSQL connection string
PG_URL=postgres://postgres:postgres@postgres:5432/fluxify_alpha

# Redis / Valkey host & port
REDIS_HOST=valkey
REDIS_PORT=6379

#====================== HOSTNAME & URLS ======================
HOSTNAME=your-domain.com
SERVER_URL=https://your-domain.com

#====================== SECURITY & KEYS ======================
ENABLE_ADMIN=true
MASTER_ENCRYPTION_KEY=<generate with tool above or: openssl rand -base64 32>
BETTER_AUTH_SECRET=<generate with tool above>
BETTER_AUTH_URL=https://your-domain.com
SYSTEM_ACCESS_KEY=<generate with tool above>

#====================== INITIAL ADMIN SEED USER ======================
SEED_USER_EMAIL=admin@your-domain.com
SEED_USER_PASSWORD=ChangeThisPassword123!
SEED_USER_NAME=Admin User
```

> [!IMPORTANT]
> **First-Run Admin Seed Account**: `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` create the initial administrator account **on first run only**. Set these before launching the container.

> [!WARNING]
> **Back up `MASTER_ENCRYPTION_KEY`**: Never change or lose `MASTER_ENCRYPTION_KEY` after initializing data. All credentials and encrypted blocks depend on this key.

---

### Step 3: Run the Application & Dependencies Stack

You can run Fluxify and its database dependencies using **Docker Compose (Recommended)** or **Manual Docker Network Run**.

#### Option A — Production Docker Compose (Recommended)

Create a `docker-compose.yml` file alongside your `.env` file to spin up Fluxify, PostgreSQL, and Valkey together:

```yaml
version: '3.8'

services:
  fluxify:
    image: ghcr.io/fluxify-rest/fluxify-kit:latest
    container_name: fluxify
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_started
    networks:
      - fluxify_net

  postgres:
    image: postgres:bullseye
    container_name: postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=fluxify_alpha
    volumes:
      - fluxify_pg_volume:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d fluxify_alpha"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - fluxify_net

  valkey:
    image: valkey/valkey:9.0-alpine
    container_name: valkey
    restart: unless-stopped
    ports:
      - "6379:6379"
    networks:
      - fluxify_net

volumes:
  fluxify_pg_volume:

networks:
  fluxify_net:
    driver: bridge
```

Launch the entire stack with a single command:

```bash
docker compose up -d
```

---

#### Option B — Manual Docker Commands with Network Linking

If you prefer using standalone `docker run` commands, create a shared Docker network so Fluxify can communicate with PostgreSQL and Valkey:

```bash
# 1. Create dedicated Docker bridge network
docker network create fluxify_net

# 2. Start PostgreSQL container
docker run -d \
  --name postgres \
  --network fluxify_net \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=fluxify_alpha \
  -v fluxify_pg_volume:/var/lib/postgresql/data \
  -p 5432:5432 \
  --restart unless-stopped \
  postgres:bullseye

# 3. Start Valkey (Redis) container
docker run -d \
  --name valkey \
  --network fluxify_net \
  -p 6379:6379 \
  --restart unless-stopped \
  valkey/valkey:9.0-alpine

# 4. Start Fluxify container connected to the same network
docker run -d \
  --name fluxify \
  --network fluxify_net \
  --env-file .env \
  -p 8080:8080 \
  --restart unless-stopped \
  ghcr.io/fluxify-rest/fluxify-kit:latest
```

---

### Step 4: Verify & Access Dashboard

After starting the containers:
1. `fluxify-kit` will automatically execute database migrations on startup.
2. The initial admin user defined in `SEED_USER_EMAIL` will be created.
3. Access the dashboard & endpoints:
   - **Admin Dashboard UI**: `http://your-host:8080/_/admin/ui` (Visual editor & management)
   - **Admin REST API**: `http://your-host:8080/_/admin/api`
   - **OpenAPI Documentation**: `http://your-host:8080/_/admin/api/openapi/ui`
   - **User Application APIs**: `http://your-host:8080/` (Root path `/` serves all user-created workflows & custom endpoints)

> [!NOTE]
> **URL Routing Namespace Isolation:** Fluxify uses the `/_/admin` prefix to separate internal platform management, auth, and the visual editor (`/_/admin/ui`) from user-built workflows. This reserves the entire root URL namespace (`/`) for custom endpoints, webhooks, and APIs built inside Fluxify without route collisions.

---

## 🔄 Upgrading

To update Fluxify to the latest version:

```bash
# Docker Compose upgrade:
docker compose pull && docker compose up -d

# Manual Docker upgrade:
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
docker stop fluxify && docker rm fluxify
docker run -d --name fluxify --network fluxify_net --env-file .env -p 8080:8080 --restart unless-stopped ghcr.io/fluxify-rest/fluxify-kit:latest
```

Database migrations apply automatically during container startup.

---

## ❓ Troubleshooting

**PostgreSQL Connection Failed (`FATAL: database "fluxify_alpha" does not exist`)**
- Ensure `POSTGRES_DB=fluxify_alpha` is set in the PostgreSQL container environment so Docker initializes the database on first boot.

**Container Exits Immediately**
- Check logs: `docker logs fluxify`
- Verify `PG_URL` hostname matches the container name (`postgres`) or host IP when connecting across networks.

**Unable to log in after first run**
- Ensure `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` were defined in `.env` **before** the container first ran.

**Port 8080 in use**
- Change the host port mapping in Compose or `docker run`: `-p 9090:8080` and update `SERVER_URL` in `.env`.
