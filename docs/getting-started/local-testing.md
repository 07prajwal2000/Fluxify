---
title: Local Testing Guide
description: How to run the full Fluxify stack locally for development and testing.
---

# Local Testing Guide

This guide walks you through setting up a complete Fluxify development environment on your local machine. By the end, you will have the frontend, backend API, worker, and all supporting services running locally.
## Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Purpose | Notes |
| :--- | :--- | :--- |
| **Git** | Cloning the repository | Any recent version |
| **Bun** | JavaScript runtime & package manager | [Install Bun](https://bun.sh/docs/installation) |
| **Docker** | Running PostgreSQL and Redis | Docker Desktop or Engine |

> [!TIP]
> Fluxify uses **Bun** (not npm or yarn) as its runtime. Make sure `bun --version` works in your terminal before proceeding.
## Step 1: Clone the Repository

```bash
git clone https://github.com/fluxify-rest/Fluxify.git
cd Fluxify
```
## Step 2: Install Dependencies

```bash
bun install
```

This installs all workspace dependencies across the monorepo (`apps/`, `packages/`).
## Step 3: Configure Your Environment

Copy the example environment file:

```bash
cp env.example .env
```

Open `.env` and fill in at minimum the following values for a working local setup:

```env
# Database
PG_URL=postgres://postgres:postgres@localhost:5432/fluxify

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth & Security
BETTER_AUTH_SECRET=any-random-string-for-local-dev
BETTER_AUTH_URL=http://localhost:8080
SYSTEM_ACCESS_KEY=any-random-string-for-local-dev
MASTER_ENCRYPTION_KEY=ZlhiQmhaS3JSeG5qTDZoWlZMbTd1WDE3aFhvYVlUVjE=

# Initial admin user (created on first run)
SEED_USER_EMAIL=admin@example.com
SEED_USER_PASSWORD=admin123
SEED_USER_NAME=Admin

# URLs
SERVER_URL=http://localhost:8080
HOSTNAME=localhost
```

> [!IMPORTANT]
> The `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` values define the initial admin account. You must set these before the first run — you will use them to log into the dashboard.

See [Self-Hosting Deployment Guides](../deployments/index.md) for the complete `.env` schema and description of every variable.
## Step 4: Start Databases with Docker

The project includes a `docker-compose` configuration that starts PostgreSQL and Redis:

```bash
docker compose up -d
```

Verify the containers are running:

```bash
docker compose ps
```

You should see both `postgres` and `redis` containers in a healthy state.
## Step 5: Start the Application

Run all services (frontend, backend API, worker) in development mode with a single command:

```bash
bun run dev
```

This starts:

| Service | Default URL | Description |
| :--- | :--- | :--- |
| **Frontend** (Next.js) | `http://localhost:3000` | Visual workflow editor |
| **Backend API & Worker** | `http://localhost:5500` | Execution engine and REST API |
| **AI Gateway** | `http://localhost:8001` | LLM integration proxy (WIP) |

> [!NOTE]
> On first startup, the server will automatically run database migrations and seed the initial admin user defined in your `.env` file.
## Step 6: Access the Dashboard

Open your browser and navigate to:

```
http://localhost:3000
```

Log in with the `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` you set in `.env`.
## Running the Docs Locally

If you want to contribute to or preview the documentation:

```bash
bun run docs:dev
```

The docs site will be available at `http://localhost:5173` (or the next available port).
## Useful Commands

| Command | Description |
| :--- | :--- |
| `bun run dev` | Start all services in development mode |
| `bun run build` | Build all packages for production |
| `bun run test` | Run the test suite |
| `bun run lint` | Lint all TypeScript/JavaScript files |
| `bun run docs:dev` | Start the documentation site in dev mode |
| `docker compose up -d` | Start PostgreSQL and Redis in the background |
| `docker compose down` | Stop and remove the database containers |
## Troubleshooting

**Cannot connect to PostgreSQL**
- Ensure Docker is running and the `postgres` container is healthy: `docker compose ps`
- Check that `PG_URL` in your `.env` matches the exposed port (default: `5432`).

**Cannot log in after first run**
- Ensure `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` were set **before** the server first started.
- If the seed user was not created, bring Docker down (`docker compose down -v`), reset your database, and restart.

**Port conflicts**
- If port `3000` or `5500` is in use, update `WEB_PORT` and `SERVER_PORT` in your `.env` file accordingly.

**`bun` not found**
- Install Bun from [bun.sh](https://bun.sh/docs/installation) and ensure it is on your `PATH`.
