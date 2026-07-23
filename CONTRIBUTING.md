# Contributing to Fluxify

Welcome to the Fluxify contributor guide! Fluxify is an open-source Low-Code Agentic Backend development platform built as a monorepo. We welcome all contributions — code fixes, new workflow blocks, security enhancements, and documentation updates.

> [!WARNING]
> **Alpha Software Notice:** Fluxify is currently in **active alpha development**. Architecture, internal APIs, and features are subject to rapid change. For major contributions, please open an issue or discussion on GitHub first to coordinate with the core team.

> [!TIP]
> **Automatic Pre-commit Hooks:** Running `bun install` configures Git pre-commit hooks via `scripts/setup-hooks.ts`. Every commit automatically runs linting, secret scanning (`secretlint`), complexity analysis (`fta-cli`), and selective unit tests to protect against credential leaks and maintain high code quality.

---

## 🚀 Quickstart (TL;DR)

For experienced developers who want to start immediately:

```bash
# 1. Clone & enter directory
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify

# 2. Install monorepo dependencies & configure git hooks
bun install

# 3. Start background infrastructure
docker compose up -d

# 4. Prepare environment configuration files
cp env.example .env
cp apps/server/env.example apps/server/.env
cp apps/ai-gateway/env.example apps/ai-gateway/.env
cp apps/web/env.example apps/web/.env

# 5. Push database migrations
bun run db:migrate

# 6. Start full development stack
bun run dev
```

---

## 🛠️ Prerequisites

Ensure you have the following installed locally:

| Tool | Minimum Version | Purpose |
| :--- | :--- | :--- |
| **Bun** | `v1.3.0+` | Primary JavaScript runtime & workspace package manager ([Install Bun](https://bun.sh)) |
| **Docker** | `v20.10+` | Container runtime for PostgreSQL, Valkey (Redis), Caddy, OpenObserve, Arize Phoenix |
| **Git** | `v2.30+` | Version control & pre-commit hooks |
| **GitHub CLI (`gh`)** | `v2.0+` | Recommended tool for opening PRs, managing issues, and syncing branches |

---

## 📦 Step-by-Step Setup

### Step 1: Fork & Clone

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git
cd Fluxify
```

### Step 2: Install Dependencies

```bash
bun install
```
*(Triggers `bun run prepare` to register Git pre-commit hooks).*

### Step 3: Start Infrastructure Services

Fluxify relies on PostgreSQL, Valkey (Redis), Caddy, OpenObserve, and Arize Phoenix via [`docker-compose.yml`](docker-compose.yml). Docker Compose automatically manages the persistent database volume `fluxify_pg_volume`.

Spin up infrastructure containers in the background:

```bash
docker compose up -d
```

### Step 4: Configure Environment Files

Copy default `.env` templates across the workspace:

```bash
cp env.example .env
cp apps/server/env.example apps/server/.env
cp apps/ai-gateway/env.example apps/ai-gateway/.env
cp apps/web/env.example apps/web/.env
```

Key environment variables to verify:
- `PG_URL`: `postgres://postgres:postgres@localhost:5432/fluxify_alpha`
- `REDIS_HOST`: `localhost`
- `REDIS_PORT`: `6379`
- `DOCKER_HOST` *(for container integration tests)*:
  - **Windows**: `DOCKER_HOST="npipe:////./pipe/docker_engine"`
  - **Linux / macOS**: `DOCKER_HOST="unix:///var/run/docker.sock"`

### Step 5: Initialize Database Schema

Push the Drizzle ORM schema to your local PostgreSQL instance:

```bash
bun run db:migrate
```

### Step 6: Start Development Servers

Start the full monorepo stack:

```bash
bun run dev
```

Navigate to:
- **Admin Dashboard UI**: `http://localhost:8080/_/admin/ui` (Visual editor & management interface)
- **Admin REST API**: `http://localhost:8080/_/admin/api`
- **OpenAPI Documentation**: `http://localhost:8080/_/admin/api/openapi/ui`
- **User Application APIs**: `http://localhost:8080/` (Root path `/` serves user-created workflows & endpoints)

> [!NOTE]
> **Why `/_/admin` Prefix?** Fluxify uses `/_/admin` to isolate internal platform APIs, management features, and the visual workflow builder. This leaves the entire root URL space (`/`) dedicated to user-defined low-code APIs, webhooks, and custom application routes without path collisions.

---

## ⚡ Fast Developer Inner-Loop

To save memory and speed up HMR, you don't always need to run the full stack. Work on individual apps or packages using targeted commands:

### Running Specific Microservices

| Focus Area | Command | Description |
| :--- | :--- | :--- |
| **Full Stack** | `bun run dev` | Runs backend server, visual editor, AI gateway, and docs concurrently |
| **Backend Server** | `bun run dev:server` | Starts only `apps/server` with hot-reloading |
| **Visual UI Editor** | `bun run dev:web` | Starts only `apps/web` (Next.js frontend) |
| **AI Gateway** | `bun run dev:ai` | Starts only `apps/ai-gateway` LLM proxy |
| **Documentation** | `bun run dev:docs` | Starts VitePress documentation site locally |

### Targeted Testing (Fast Feedback)

Instead of running global test suites, run tests relevant to your changes:

| Focus Area | Command | Purpose |
| :--- | :--- | :--- |
| **Core Engine** | `bun run test:lib` | Tests `@fluxify/lib` (VM, state, execution engine) |
| **Workflow Blocks** | `bun run test:blocks` | Tests `@fluxify/blocks` (node definitions & schemas) |
| **Adapters** | `bun run test:adapters` | Tests `@fluxify/adapters` (integrations & external services) |
| **Server Unit** | `bun run test:server:unit` | Unit tests for `apps/server` |
| **Global Unit** | `bun run test:unit` | Fast unit tests across all packages (excluding `*.spec.ts`) |
| **Security Scan** | `bun run security:scan` | Scans for leaked secrets using `secretlint` |

---

## 📂 Monorepo Architecture & Commands

Fluxify separates code into application entrypoints (`apps/`) and reusable core modules (`packages/`):

| Package Path | Workspace Name | 1-Line Description |
| :--- | :--- | :--- |
| `packages/adapters` | `@fluxify/adapters` | Service adapters (database, API, cloud integrations). |
| `packages/blocks` | `@fluxify/blocks` | Visual workflow block definitions, schemas, and actions. |
| `packages/common` | `@fluxify/common` | Shared utilities, constants, and helper modules. |
| `packages/lib` | `@fluxify/lib` | Core workflow execution engine, VM, and state runtime. |

### Complete Package Commands Reference

| Script Command | Description & Proper Usage |
| :--- | :--- |
| `bun run dev` | Runs all development servers concurrently. |
| `bun run dev:server` | Starts backend API server (`apps/server`) in watch mode. |
| `bun run dev:web` | Starts Next.js frontend UI (`apps/web`). |
| `bun run dev:ai` | Starts AI Gateway proxy (`apps/ai-gateway`). |
| `bun run dev:docs` | Starts VitePress documentation server with live reload. |
| `bun run test:lib` | Runs unit & integration tests for `@fluxify/lib`. |
| `bun run test:blocks` | Runs unit & integration tests for `@fluxify/blocks`. |
| `bun run test:adapters` | Runs tests for `@fluxify/adapters`. |
| `bun run test:unit` | Runs fast unit tests across all packages. |
| `bun run test:integration` | Runs parallel integration test suites (`*.test.ts`). |
| `bun run test:server:unit` | Runs unit tests for `apps/server`. |
| `bun run test:server:integration` | Runs integration tests for `apps/server`. |
| `bun run lint` | Lints all packages and applications via Turborepo. |
| `bun run analyze` | Runs static code analysis & complexity scoring using `fta-cli`. |
| `bun run security:scan` | Scans codebase for secret leaks using `secretlint`. |
| `bun run build` | Builds production bundles across all packages and apps. |
| `bun run db:generate` | Generates new Drizzle SQL migration files. |
| `bun run db:migrate` | Applies Drizzle database migrations directly to PostgreSQL. |
| `bun run docs:build` | Compiles documentation site for production. |

---

## 🔀 Git Workflow & Pull Request Guidelines

1. **Branch Naming Standard:** Always work in a feature branch off `main`.
   - `feature/description` (e.g. `feature/add-oauth-block`)
   - `fix/description` (e.g. `fix/cors-header-bug`)
   - `docs/description` (e.g. `docs/update-contributing`)
2. **Submitting Pull Requests:** Use the GitHub CLI (`gh`) to open PRs against the upstream repo:
   ```bash
   gh pr create --repo fluxify-rest/Fluxify --base main
   ```
3. **PR Expectations:** Include clear descriptions of **Why** and **What** changed. Ensure pre-commit checks (`bun run lint`, `bun run security:scan`, `bun run test:unit`) pass.

Thank you for helping build Fluxify! 🚀