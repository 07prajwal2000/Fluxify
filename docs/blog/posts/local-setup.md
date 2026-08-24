---
title: How to Set Up Fluxify Locally and Start Contributing
date: 2025-11-24
author: Prajwal Aradhya
tags:
  - getting-started
  - contributing
---

# How to Set Up Fluxify Locally and Start Contributing

Fluxify is an open-source, no/low-code backend engine for building APIs with ease. This is the complete path from a fresh clone to a running stack, plus where to put your change once you're ready to contribute.

::: warning Alpha software
Architecture, internal APIs, and features change quickly. For anything substantial, open an issue or discussion first so you don't build something that's about to move.
:::

::: tip Pre-commit hooks are automatic
Installing dependencies registers Git hooks for you. Every commit runs linting, secret scanning, complexity analysis, and a selective test run — so most mistakes get caught before they ever leave your machine.
:::

::: info Contributing accepts the CLA
There's nothing to sign. Opening a pull request is your acceptance of the Contributor License Agreement, and you keep ownership of your work. More on that at the end of this post.
:::

## Prerequisites

| Tool | Minimum version | Purpose |
| :--- | :--- | :--- |
| **Bun** | `v1.4.0+` | Runtime and workspace package manager ([install](https://bun.sh)) |
| **Docker** | `v20.10+` | PostgreSQL, Valkey, NATS, and the local observability stack |
| **Git** | `v2.30+` | Version control and pre-commit hooks |
| **GitHub CLI (`gh`)** | `v2.0+` | Recommended for pull requests, issues, and syncing branches |

::: warning Use Bun, never npm/yarn/pnpm
The workspace layout, lockfile, and scripts all assume Bun. Mixing package managers will corrupt the dependency tree.
:::

## Quickstart

For anyone who wants to jump straight in:

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify

# 2. Install dependencies & register git hooks
bun install

# 3. Start background infrastructure (Postgres, Valkey, NATS, telemetry)
docker compose up -d

# 4. Copy the environment configuration
cp env.example .env

# 5. Push the database schema
bun run db:migrate

# 6. Start the control plane only — a project needs to exist before a worker can run
bun run dev:server
```

Then, from the dashboard, create a project, copy its id into `.env` as `WORKER_PROJECT_ID`, and start everything:

```bash
bun run dev
```

The two-step start is explained in detail below.

## Step-by-step setup

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git
cd Fluxify
```

### 2. Install dependencies

```bash
bun install
```

This also registers the Git pre-commit hooks for you automatically.

### 3. Start infrastructure services

Local development needs PostgreSQL, Valkey (Redis), and NATS. The bundled Docker Compose file also brings up Caddy, OpenObserve (logs), Jaeger (traces), Prometheus (metrics), and Grafana (an observability dashboard).

```bash
docker compose up -d
```

::: warning NATS must run with JetStream enabled
Fluxify queues compilation work and stores compiled routes there. The bundled compose file already enables this — if you point at your own NATS instance instead, add the JetStream flag or nothing will compile.
:::

### 4. Configure your environment

Every app in the monorepo reads from one root `.env` file:

```bash
cp env.example .env
```

Values worth checking before you start anything:

| Variable | Local value | Notes |
| :--- | :--- | :--- |
| `PG_URL` | `postgres://postgres:postgres@localhost:5432/fluxify_alpha` | |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | |
| `NATS_URL` | `nats://localhost:4222` | |
| `NATS_TOKEN` | `fluxify_nats_token` | Must match the compose file |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Local trace collector endpoint |
| `MASTER_ENCRYPTION_KEY` | any base64 value | Encrypts stored credentials |
| `WORKER_PROJECT_ID` | *(empty for now)* | Filled in once you create a project — see step 6 |
| `DOCKER_HOST` | see below | Only needed for container-based integration tests |

`DOCKER_HOST` for integration tests:
- **Windows**: `npipe:////./pipe/docker_engine`
- **Linux / macOS**: `unix:///var/run/docker.sock`

### 5. Initialize the database

```bash
bun run db:migrate
```

### 6. Create a project and start the worker

Fluxify's request worker serves **exactly one project**, identified by `WORKER_PROJECT_ID`. On a fresh clone, no project exists yet — so start the control plane on its own first:

```bash
bun run dev:server
```

Open the dashboard, create a project, and copy its id into `.env`:

```env
WORKER_PROJECT_ID=<your-project-id>
```

Now start the whole stack:

```bash
bun run dev
```

You only do this once. After that, saving a route in the visual editor compiles it and the worker picks it up in place — no restart required.

### 7. Open it

| Surface | URL |
| :--- | :--- |
| Admin dashboard (visual editor) | `http://localhost:8080/_/admin/ui` |
| Admin REST API | `http://localhost:8080/_/admin/api` |
| OpenAPI documentation | `http://localhost:8080/_/admin/api/openapi/ui` |
| Your workflow endpoints | `http://localhost:8080/` |
| Docs site | `http://localhost:5173` |
| Jaeger trace UI | `http://localhost:16686` |
| Prometheus UI | `http://localhost:9090` |
| Grafana UI | `http://localhost:3000` (default login: `admin` / `admin`) |

::: info Why the `/_/admin` prefix?
It isolates platform management and the visual builder, leaving the entire root path `/` free for the APIs you build — so your routes can never collide with Fluxify's own.
:::

## How Fluxify fits together

Fluxify compiles graphs into JavaScript. When you save a route, the compiler walks the block graph from the entrypoint and emits a single JavaScript function for the whole route. Workers pick up that compiled function and hot-swap it in — there's no graph traversal happening at request time.

A few consequences worth knowing before you contribute:

1. **A new block needs both an interpreter implementation and a compiler emitter.** Adding only one means the block works in one execution engine and not the other.
2. **Workers never open a database connection.** Everything they need arrives over the message bus. A database import anywhere in the worker's dependency tree is a bug.
3. **The compiled engine is the default; the legacy interpreter still runs alongside it.** Keep both working when you change block behavior — the interpreter is being phased out but isn't gone yet.

## Fast developer inner-loop

You rarely need the full stack running. Start only what you're touching:

| Focus area | Command | What it starts |
| :--- | :--- | :--- |
| **Full stack** | `bun run dev` | Server, request worker, telemetry worker, web, AI gateway, docs |
| **Backend server** | `bun run dev:server` | Admin control plane, watch mode |
| **Request worker** | `bun run dev:worker` | Compiled worker (needs `WORKER_PROJECT_ID`) |
| **Telemetry worker** | `bun run dev:telemetry` | Exports traced route runs to project destinations |
| **Legacy worker** | `bun run dev:worker:dag` | Graph interpreter — for comparison only |
| **Visual editor** | `bun run dev:web` | The dashboard app |
| **AI gateway** | `bun run dev:ai` | AI agent harness and providers |
| **Documentation** | `bun run dev:docs` | This docs site, with live reload |

## Where to put your change

| Area | What lives there |
| :--- | :--- |
| Admin server | Admin API, compiler, request workers, database schema |
| Legacy dashboard | The older Next.js admin UI — being migrated away from |
| Portal | The current dashboard, including the AI assistant UI |
| AI gateway | AI agent harness, model providers, tool integrations |
| Blocks | Block definitions, schemas, runtime actions, compiler emitters |
| Core library | Execution engine, virtual machine, state runtime |
| Adapters | Database, API, and cloud service integrations |
| Common | Shared utilities, logging, constants |
| Docs | This user-facing documentation site |

### Adding a new block

1. Define the block's schema, runtime action, **and** its compiler emitter together — a block only works end-to-end when both engines understand it.
2. Add tests alongside it.
3. Document it under `/blocks` and add it to the sidebar.
4. Run the blocks test suite before opening a PR.

### Writing documentation

This docs site is user-facing, not a technical guide, with one deliberate exception: contributor-facing posts like this one, where file paths and commands *are* the content. For everything else:

- Explain **what** happens and what to expect, not **how** it's built internally.
- Use tables and `::: tip` / `::: info` callouts for scanability.
- Keep examples concrete — show real inputs and outputs.

## Testing

::: tip Run only what your change touches
Skip the adapters test suite unless you actually modified an adapter — it spins up containers and is slow.
:::

| Focus area | Covers |
| :--- | :--- |
| **Core engine** | Execution engine, VM, state |
| **Blocks** | Block definitions, schemas, compiler output |
| **Adapters** | Integrations (slow — containers) |
| **Server unit** | Fast, no external services |
| **Server integration** | Full request paths against real infrastructure |
| **All unit** | Every fast suite across the monorepo |
| **All integration** | Every integration suite |
| **Secrets** | Leaked credentials scan |

File naming decides which suite a test lands in: `*.test.ts` is an integration test, `*.spec.ts` is a unit test.

Before opening a PR, manually exercise the part you changed. The pre-commit hook handles linting, static analysis, and a selective test run for you automatically.

## Git workflow and pull requests

Always work in a feature branch off `main`:

- `feature/description` — e.g. `feature/add-oauth-block`
- `fix/description` — e.g. `fix/cors-header-bug`
- `docs/description` — e.g. `docs/update-contributing`
- `chore/description` — e.g. `chore/bump-deps`

Push your branch to **your fork**, and open the pull request against the **upstream** repository:

```bash
git push origin feature/my-change
gh pr create --repo Fluxify-rest/Fluxify --base main
```

A good PR:

- Has a **title** that clearly summarizes the change.
- Has a **description** covering the *why* and the *what* — enough for a reviewer to understand without reading every line.
- Is **one logical change**. Split unrelated work into separate PRs.
- Passes **lint, secret scanning, and the test suites** relevant to the change.
- **Updates the docs** if it changes behavior a user would notice.

## Contributor License Agreement

Fluxify is licensed under the Apache License 2.0. Contributions are covered by the project's Contributor License Agreement (CLA).

**There is nothing to sign.** Submitting a contribution — opening a pull request, pushing a commit, or otherwise offering work for inclusion — is your acceptance of the CLA. This covers your first contribution and every one after it.

| | |
| :--- | :--- |
| ✅ You keep copyright of your work | The CLA grants a license, not ownership |
| ✅ Your code stays Apache 2.0 | In every version already released — forever |
| ✅ You can use your own contribution anywhere | It's still yours |
| ⚠️ The project may sublicense it | So a future licensing decision doesn't require tracking down every past contributor |

::: info Why a CLA and not just a DCO?
A DCO certifies you had the right to submit your code. It doesn't let the project make licensing decisions later without the written consent of every contributor. A CLA does — which is the difference between a project that can adapt and one that's frozen by its own history. This is not a plan to close the source: Apache 2.0 is irrevocable for every version already published, and nothing can take that back.
:::

If you're contributing as part of your job, make sure your employer has approved it. If they need a Corporate CLA, open a discussion on GitHub.

## Troubleshooting

**`bun run dev` exits with "WORKER_PROJECT_ID is required"**
The compiled worker needs a project to serve. See [step 6](#_6-create-a-project-and-start-the-worker) above.

**Routes save but never become reachable**
NATS is running without JetStream. Restart it with the JetStream flag — the bundled compose file already does this by default.

**Worker starts and then fails every request**
`MASTER_ENCRYPTION_KEY` differs between the control plane and the worker. Project configuration reaches the worker encrypted with this key, so both must match exactly.

**Integration tests can't reach Docker**
Set `DOCKER_HOST` — see step 4 above.

---

Any issues, suggestions, or feedback? Open an issue on [GitHub](https://github.com/Fluxify-rest/Fluxify).
