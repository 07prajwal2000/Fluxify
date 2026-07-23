---
title: Contributing to Fluxify
description: Complete developer contribution guide for Fluxify — quickstart lifecycle, environment setup, fast inner-loop workflows, Docker Compose, monorepo package commands, and PR guidelines.
---

# Contributing to Fluxify

Thank you for your interest in contributing! Fluxify is an open-source Low-Code Agentic Backend development platform in **alpha**, built as a high-performance monorepo. Every contribution — code fixes, new workflow blocks, security enhancements, or documentation updates — genuinely matters.

> [!WARNING]
> **Alpha Stage Software:** Fluxify is in **active alpha development**. Platform architecture, core modules, and internal APIs may evolve between releases. If you are planning a large contribution, we recommend opening a [GitHub Issue](https://github.com/fluxify-rest/Fluxify/issues) or [Discussion](https://github.com/fluxify-rest/Fluxify/discussions) first to discuss your approach with maintainers.

> [!TIP]
> **Automatic Pre-commit Hooks:** Running `bun install` configures Git pre-commit hooks via `scripts/setup-hooks.ts`. The pre-commit hook automatically runs code linting, secret scanning (`secretlint`), complexity analysis (`fta-cli`), and selective testing before commits are saved.

---

## 🚀 Quickstart Checklist (TL;DR)

For experienced developers who want to start immediately:

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify

# 2. Install dependencies & setup git hooks
bun install

# 3. Start background infrastructure
docker compose up -d

# 4. Prepare environment files
cp env.example .env
cp apps/server/env.example apps/server/.env
cp apps/ai-gateway/env.example apps/ai-gateway/.env
cp apps/web/env.example apps/web/.env

# 5. Push database schema migrations
bun run db:migrate

# 6. Start development servers
bun run dev
```

---

## 🛠️ Prerequisites & Environment Setup

Ensure you have the following installed locally before proceeding:

| Tool | Minimum Version | Purpose | Notes |
| :--- | :--- | :--- | :--- |
| **Bun** | `v1.3.0+` | Monorepo package manager & JS runtime | [Install Bun](https://bun.sh) |
| **Docker** | `v20.10+` | Container runtime for PostgreSQL, Redis, telemetry | Docker Desktop or Engine |
| **Git** | `v2.30+` | Version control & pre-commit hooks | Any recent version |
| **GitHub CLI (`gh`)** | `v2.0+` | Recommended tool for PRs & issue tracking | `brew install gh` or `winget install GitHub.cli` |

---

## 📦 Step-by-Step Installation Guide

### Step 1: Fork & Clone

Fork the repository on GitHub and clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git
cd Fluxify
```

### Step 2: Install Workspace Dependencies

```bash
bun install
```

> [!NOTE]
> Running `bun install` executes the `prepare` script (`scripts/setup-hooks.ts`), which configures `.git/hooks/pre-commit` for automated linting, secret scanning, and testing.

### Step 3: Start Infrastructure Services

Fluxify relies on PostgreSQL, Valkey (Redis), Caddy, OpenObserve, and Arize Phoenix via [`docker-compose.yml`](../../docker-compose.yml). Docker Compose automatically manages the persistent database volume `fluxify_pg_volume`.

Spin up all infrastructure containers in the background:

```bash
docker compose up -d
```

Verify service health:
```bash
docker compose ps
```

### Step 4: Configure Environment Files

Copy template environment files to root and app workspaces:

```bash
# Root workspace environment
cp env.example .env

# Server application environment
cp apps/server/env.example apps/server/.env

# AI Gateway environment
cp apps/ai-gateway/env.example apps/ai-gateway/.env

# Web application environment
cp apps/web/env.example apps/web/.env
```

Ensure environment keys are properly populated:
- **`PG_URL`**: `postgres://postgres:postgres@localhost:5432/fluxify_alpha`
- **`REDIS_HOST` & `REDIS_PORT`**: `localhost:6379`
- **`DOCKER_HOST`** *(required for container integration tests)*:
  - **Windows**: `DOCKER_HOST="npipe:////./pipe/docker_engine"`
  - **Linux / macOS**: `DOCKER_HOST="unix:///var/run/docker.sock"`

#### Interactive Secret Key Generator

Use the tool below to generate cryptographically secure keys for `MASTER_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and `SYSTEM_ACCESS_KEY`:

<KeyGenerator />

### Step 5: Apply Database Schema Migrations

Apply Drizzle ORM schema migrations to your local PostgreSQL database:

```bash
bun run db:migrate
```

### Step 6: Start the Development Server

Start all services (frontend, backend API server, AI gateway, docs) concurrently:

```bash
bun run dev
```

Navigate to:
- **Admin Dashboard UI**: `http://localhost:8080/_/admin/ui` (Visual editor & platform management)
- **Admin REST API**: `http://localhost:8080/_/admin/api`
- **OpenAPI Documentation**: `http://localhost:8080/_/admin/api/openapi/ui`
- **User Application APIs**: `http://localhost:8080/` (Root path `/` serves all user-defined low-code APIs & webhooks)

> [!NOTE]
> **Why `/_/admin` Prefix?** Fluxify uses `/_/admin` to isolate internal platform management, auth, and the visual workflow editor (`/_/admin/ui`). This reserves the entire root URL namespace (`/`) for custom endpoints, webhooks, and APIs created inside Fluxify without route collisions.

---

## ⚡ Fast Developer Inner-Loop

To save memory and speed up HMR, work on specific components using focused scripts:

### Targeted Microservice Commands

| Focus Area | Command | Description |
| :--- | :--- | :--- |
| **Full Stack** | `bun run dev` | Runs backend server, visual editor, AI gateway, and docs concurrently |
| **Backend Server** | `bun run dev:server` | Starts only `apps/server` with hot-reloading |
| **Visual UI Editor** | `bun run dev:web` | Starts only `apps/web` (Next.js frontend) |
| **AI Gateway** | `bun run dev:ai` | Starts only `apps/ai-gateway` LLM proxy |
| **Documentation** | `bun run dev:docs` | Starts VitePress documentation server with live reload |

### Targeted Testing (Fast Feedback)

Run tests relevant to the code you are editing to avoid long feedback loops:

| Focus Area | Command | Purpose |
| :--- | :--- | :--- |
| **Core Engine** | `bun run test:lib` | Tests `@fluxify/lib` (VM, state runtime, execution engine) |
| **Workflow Blocks** | `bun run test:blocks` | Tests `@fluxify/blocks` (node definitions & schemas) |
| **Adapters** | `bun run test:adapters` | Tests `@fluxify/adapters` (integrations & external services) |
| **Server Unit** | `bun run test:server:unit` | Unit tests for `apps/server` |
| **Global Unit** | `bun run test:unit` | Fast unit tests across all packages (excluding `*.spec.ts`) |
| **Security Scan** | `bun run security:scan` | Scans codebase for secret leaks using `secretlint` |

---

## 📂 Monorepo Architecture & Package Commands

Fluxify is organized as a monorepo containing application workspaces under `apps/` and core logic packages under `packages/`.

### Monorepo Packages (`packages/`)

| Package Path | Workspace Name | 1-Line Description |
| :--- | :--- | :--- |
| `packages/adapters` | `@fluxify/adapters` | External service, database, and API integration adapters. |
| `packages/blocks` | `@fluxify/blocks` | Pre-built workflow node block definitions, actions, and schemas. |
| `packages/common` | `@fluxify/common` | Monorepo-wide shared utility functions, constants, and helper modules. |
| `packages/lib` | `@fluxify/lib` | Core workflow execution engine, virtual machine, and state runtime. |

### Complete Package Commands Reference

| Script Command | Purpose & Proper Usage |
| :--- | :--- |
| `bun run dev` | Runs all development servers concurrently. |
| `bun run dev:server` | Starts backend API server (`apps/server`) in watch mode. |
| `bun run dev:web` | Starts Next.js frontend (`apps/web`) using Turborepo filters. |
| `bun run dev:ai` | Starts AI Gateway proxy (`apps/ai-gateway`) in watch mode. |
| `bun run dev:docs` | Starts VitePress documentation server with live reload. |
| `bun run test:lib` | Runs unit and integration tests for `@fluxify/lib`. |
| `bun run test:blocks` | Runs tests for `@fluxify/blocks`. |
| `bun run test:adapters` | Runs tests for `@fluxify/adapters`. |
| `bun run test:unit` | Runs fast unit tests across all packages (ignoring `*.spec.ts`). |
| `bun run test:integration` | Runs parallel integration test suites (`*.test.ts`) across all packages. |
| `bun run test:server:unit` | Runs unit tests specifically for `apps/server`. |
| `bun run test:server:integration` | Runs integration tests specifically for `apps/server`. |
| `bun run lint` | Lints all packages and applications via Turborepo. |
| `bun run analyze` | Performs static code quality and complexity analysis using `fta-cli`. |
| `bun run security:scan` | Scans codebase for secret leaks and exposed credentials using `secretlint`. |
| `bun run build` | Builds production bundles for all packages and applications. |
| `bun run db:generate` | Generates Drizzle migration files for `apps/server`. |
| `bun run db:migrate` | Applies Drizzle database migrations directly to PostgreSQL. |
| `bun run docs:build` | Compiles the documentation site for production. |

---

## 🔀 Development Workflow & Guidelines

### Branching Strategy

Always create dedicated feature branches using the GitHub CLI (`gh`):

```bash
gh repo fork --clone=false
git checkout -b feature/my-new-block
# or
git checkout -b fix/auth-token-issue
```

Branch names must be concise, lowercase, and follow conventions: `feature/*`, `fix/*`, `docs/*`, `refactor/*`, or `chore/*`.

### Submitting Pull Requests

1. Commit your changes. Pre-commit hooks will automatically lint, scan secrets, and test modified code.
2. Push your branch to your fork and open a PR against the upstream `main` branch:
   ```bash
   gh pr create --repo fluxify-rest/Fluxify --base main
   ```
3. Ensure PR titles and descriptions clearly state **Why** the change was made and **What** was updated.

Thank you for helping build Fluxify! 🚀
