# Contributing to Fluxify

Welcome! Fluxify is an open-source low-code agentic backend platform, built as a
Bun monorepo. Code fixes, new workflow blocks, security hardening, and
documentation improvements are all welcome.

This guide is written so you can go from a fresh clone to a running stack, and
know where to put your change, without having to ask anyone.

> [!WARNING]
> **Alpha software.** Architecture, internal APIs, and features change quickly.
> For anything substantial, open an issue or discussion first so you don't build
> something that's about to move.

> [!TIP]
> **Pre-commit hooks are automatic.** `bun install` registers Git hooks via
> `scripts/setup-hooks.ts`. Every commit runs linting, secret scanning
> (`secretlint`), complexity analysis (`fta-cli`), and selective unit tests.

> [!IMPORTANT]
> **Contributing accepts our CLA.** There is nothing to sign — opening a pull
> request is your acceptance. You keep ownership of your work. See
> [Contributor License Agreement](#contributor-license-agreement) below.

---

## Contents

1. [Quickstart](#quickstart)
2. [Prerequisites](#prerequisites)
3. [Step-by-step setup](#step-by-step-setup)
4. [How Fluxify fits together](#how-fluxify-fits-together)
5. [Fast developer inner-loop](#fast-developer-inner-loop)
6. [Where to put your change](#where-to-put-your-change)
7. [Testing](#testing)
8. [Command reference](#command-reference)
9. [Git workflow & pull requests](#git-workflow--pull-requests)
10. [Contributor License Agreement](#contributor-license-agreement)
11. [Troubleshooting](#troubleshooting)

---

## Quickstart

For experienced developers who want to start immediately:

```bash
# 1. Clone & enter directory
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify

# 2. Install monorepo dependencies & configure git hooks
bun install

# 3. Start background infrastructure (Postgres, Valkey, NATS, telemetry)
docker compose up -d

# 4. Prepare environment configuration file
cp env.example .env

# 5. Push the database schema
bun run db:migrate

# 6. Start the control plane only — you need a project before the worker runs
bun run dev:server
```

Then create a project in the dashboard, put its id in `.env` as
`WORKER_PROJECT_ID`, and start everything:

```bash
bun run dev
```

The two-step start is explained in [Step 6](#step-6-create-a-project-and-start-the-worker).

---

## Prerequisites

| Tool | Minimum version | Purpose |
| :--- | :--- | :--- |
| **Bun** | `v1.3.0+` | Runtime and workspace package manager ([install](https://bun.sh)) |
| **Docker** | `v20.10+` | PostgreSQL, Valkey, NATS, Caddy, OpenObserve, Jaeger, Prometheus, Grafana |
| **Git** | `v2.30+` | Version control and pre-commit hooks |
| **GitHub CLI (`gh`)** | `v2.0+` | Recommended for PRs, issues, and syncing branches |

> [!IMPORTANT]
> **Use `bun`, never `npm`/`yarn`/`pnpm`.** The workspace layout, lockfile, and
> scripts all assume Bun. Mixing package managers will corrupt the dependency
> tree.

---

## Step-by-step setup

### Step 1: Fork & clone

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git
cd Fluxify
```

### Step 2: Install dependencies

```bash
bun install
```

This also runs `bun run prepare`, which registers the Git pre-commit hooks.

### Step 3: Start infrastructure services

Local development needs PostgreSQL, Valkey (Redis), and NATS. The root
[`docker-compose.yml`](docker-compose.yml) also brings up Caddy, OpenObserve
(logs), Jaeger (OpenTelemetry traces), Prometheus (metrics), and Grafana
(observability UI).

```bash
docker compose up -d
```

> [!IMPORTANT]
> **NATS must run with JetStream enabled (`-js`).** Fluxify queues compile work
> and stores compiled routes there. The bundled compose file already sets this —
> if you point at your own NATS, add the flag or nothing will compile.

### Step 4: Configure environment

Every app in the monorepo reads one root `.env`:

```bash
cp env.example .env
```

Values worth checking:

| Variable | Local value | Notes |
| :--- | :--- | :--- |
| `PG_URL` | `postgres://postgres:postgres@localhost:5432/fluxify_alpha` | |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | |
| `NATS_URL` | `nats://localhost:4222` | |
| `NATS_TOKEN` | `fluxify_nats_token` | Must match the compose file |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Jaeger OTLP HTTP endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | Use `grpc` with `http://localhost:4317` for OTLP gRPC |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://localhost:9090/api/v1/otlp/v1/metrics` | Prometheus OTLP HTTP metrics endpoint |
| `MASTER_ENCRYPTION_KEY` | any base64 value | Encrypts stored credentials |
| `WORKER_PROJECT_ID` | *(empty for now)* | Filled in at Step 6 |
| `DOCKER_HOST` | see below | Only for container integration tests |

`DOCKER_HOST` for integration tests:
- **Windows**: `npipe:////./pipe/docker_engine`
- **Linux / macOS**: `unix:///var/run/docker.sock`

### Step 5: Initialize the database

```bash
bun run db:migrate
```

### Step 6: Create a project and start the worker

Fluxify's request worker serves **exactly one project**, named by
`WORKER_PROJECT_ID`. On a fresh clone no project exists yet, so start the
control plane on its own first:

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

You only do this once. After that, saving a route in the editor compiles it and
the worker picks it up in place — no restart.

### Step 7: Open it

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

> [!NOTE]
> **Why the `/_/admin` prefix?** It isolates platform management and the visual
> builder, leaving the entire root path `/` free for the APIs users build — so
> their routes can never collide with ours.

### Local tracing

The local stack accepts OpenTelemetry traces through either OTLP transport:

| Transport | Endpoint |
| :--- | :--- |
| OTLP/gRPC | `http://localhost:4317` |
| OTLP/HTTP | `http://localhost:4318` |

Open Jaeger at `http://localhost:16686` to search trace data directly. Grafana
is available at `http://localhost:3000`; its provisioned **Jaeger** data source
points at the local collector automatically. The Jaeger all-in-one container is
intended for development, so its trace storage is ephemeral.

### Local metrics

Prometheus accepts metrics pushed through OTLP/HTTP at
`http://localhost:9090/api/v1/otlp/v1/metrics`; configure this as
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`. Its UI is at `http://localhost:9090`,
and Grafana automatically includes it as the **Prometheus** data source.

---

## How Fluxify fits together

Read [`docs/architecture/`](docs/architecture/) for the user-facing version. The
short contributor version:

**Fluxify compiles graphs into JavaScript.** When a route is saved, the compiler
walks the block graph from the entrypoint and emits a single JavaScript function
for the whole route, which is published to a NATS KV bucket. Workers watch that
bucket and hot-swap the function in. Requests execute that function directly —
there is no graph traversal at request time.

Three consequences shape most contributions:

1. **A block needs both an interpreter implementation and a compiler emitter.**
   Adding one without the other means the block works in one engine and not the
   other.
2. **Workers never open a database connection.** They receive everything they
   need over NATS. Don't add a database import to anything under the worker's
   dependency tree.
3. **The compiled engine is the default; the interpreter is still around.**
   `bun run dev:worker` runs the compiled worker. `bun run dev:worker:dag` runs
   the legacy graph interpreter, kept until the compiled path finishes manual
   testing. Changes to block behaviour should keep both working.

---

## Fast developer inner-loop

You rarely need the full stack. Run only what you're touching:

| Focus area | Command | What it starts |
| :--- | :--- | :--- |
| **Full stack** | `bun run dev` | Server, worker, web, AI gateway, docs |
| **Backend server** | `bun run dev:server` | `apps/server` control plane, watch mode |
| **Request worker** | `bun run dev:worker` | Compiled worker (needs `WORKER_PROJECT_ID`) |
| **Legacy worker** | `bun run dev:worker:dag` | Graph interpreter — comparison only |
| **Visual editor** | `bun run dev:web` | `apps/web` (Next.js) |
| **AI gateway** | `bun run dev:ai` | `apps/ai-gateway` |
| **Documentation** | `bun run dev:docs` | VitePress site |

---

## Where to put your change

| Path | Workspace | What lives there |
| :--- | :--- | :--- |
| `apps/server` | `@fluxify/server` | Admin API, compiler, request workers, database schema |
| `apps/web` | `@fluxify/web` | Admin dashboard (Next.js). Legacy — being migrated to `apps/portal` |
| `apps/portal` | `@fluxify/portal` | The new dashboard, including the AI assistant UI |
| `apps/ai-gateway` | `@fluxify/ai-gateway` | AI agent harness, LLM providers, MCP tooling |
| `packages/blocks` | `@fluxify/blocks` | Block definitions, schemas, runtime actions, compiler emitters |
| `packages/lib` | `@fluxify/lib` | Execution engine, VM, state runtime |
| `packages/adapters` | `@fluxify/adapters` | Database, API, and cloud service integrations |
| `packages/common` | `@fluxify/common` | Shared utilities, logging, constants |
| `docs/` | — | User-facing documentation (VitePress) |

### Adding a new block

1. Define it in `packages/blocks/builtin/` — schema, runtime action, **and** the
   compiler emitter that turns it into JavaScript.
2. Add tests beside it in `packages/blocks/builtin/tests/`.
3. Document it in `docs/blocks/` and add it to the sidebar in
   `docs/.vitepress/config.ts`.
4. Run `bun run test:blocks`.

### Adding an admin API endpoint

Endpoints live in `apps/server/src/api/v1/<resource>/<action>/` and follow a
consistent four-file shape — `dto.ts` (Zod schemas), `repository.ts` (database),
`service.ts` (logic), `route.ts` (HTTP + OpenAPI). Copy an existing action
rather than inventing a new layout.

### Writing documentation

`docs/` is **user-facing**, not a technical guide. Write for junior developers
and non-technical readers:

- ✅ Explain **what** happens and what to expect.
- ✅ Use tables, `::: tip` / `::: info` callouts, and concrete examples.
- ✅ Mermaid diagrams are supported — use a ` ```mermaid ` fence.
- ❌ Don't reference source files, class names, or internal module names.
- ❌ Don't describe *how* it's built internally.

---

## Testing

> [!TIP]
> Run only the suites your change touches. **Skip `test:adapters` unless you
> modified `packages/adapters/`** — it spins up containers and is slow.

| Focus area | Command | Covers |
| :--- | :--- | :--- |
| **Core engine** | `bun run test:lib` | `@fluxify/lib` — VM, state, execution |
| **Blocks** | `bun run test:blocks` | Block definitions, schemas, compiler output |
| **Adapters** | `bun run test:adapters` | Integrations (slow — containers) |
| **Server unit** | `bun run test:server:unit` | `apps/server` unit tests |
| **Server integration** | `bun run test:server:integration` | `apps/server` integration tests |
| **All unit** | `bun run test:unit` | Fast unit tests across every package |
| **All integration** | `bun run test:integration` | Every integration suite |
| **Secrets** | `bun run security:scan` | Leaked credentials via `secretlint` |

File naming decides which suite a test lands in:

- `*.test.ts` → integration tests
- `*.spec.ts` → unit tests

Before opening a PR, manually exercise the parts you changed. The pre-commit
hook handles linting, analysis, and a selective test run.

---

## Command reference

| Command | Description |
| :--- | :--- |
| `bun run dev` | All development servers concurrently |
| `bun run dev:server` | Backend control plane, watch mode |
| `bun run dev:worker` | Compiled request worker, watch mode |
| `bun run dev:worker:dag` | Legacy graph interpreter worker |
| `bun run dev:web` | Next.js dashboard |
| `bun run dev:ai` | AI gateway |
| `bun run dev:docs` | VitePress docs with live reload |
| `bun run build` | Production bundles for every package and app |
| `bun run lint` | Lint everything via Turborepo |
| `bun run analyze` | Static analysis & complexity scoring (`fta-cli`) |
| `bun run security:scan` | Secret scanning (`secretlint`) |
| `bun run test:*` | See [Testing](#testing) |
| `bun run db:generate` | Generate a new Drizzle migration |
| `bun run db:migrate` | Apply the schema to PostgreSQL |
| `bun run docs:build` | Build the documentation site |
| `bun run docs:preview` | Preview the built documentation site |

---

## Git workflow & pull requests

### Branch naming

Always work in a feature branch off `main`:

- `feature/description` — e.g. `feature/add-oauth-block`
- `fix/description` — e.g. `fix/cors-header-bug`
- `docs/description` — e.g. `docs/update-contributing`
- `chore/description` — e.g. `chore/bump-deps`

### Opening a pull request

Push your branch to **your fork**, and open the PR against the **upstream**
repository:

```bash
git push origin feature/my-change
gh pr create --repo Fluxify-rest/Fluxify --base main
```

### What a good PR looks like

Opening a PR also accepts our CLA — see below. There's nothing to do in advance.

## Contributor License Agreement

Fluxify is licensed under the [Apache License 2.0](LICENSE). Contributions are
covered by our [Contributor License Agreement](CLA.md).

**There is nothing to sign.** Submitting a contribution — opening a pull
request, pushing a commit, or otherwise offering work for inclusion — is your
acceptance of the CLA. This covers your first contribution and every one after
it.

### What it does and doesn't do

| | |
| :--- | :--- |
| ✅ You keep copyright of your work | The CLA grants a licence, not ownership |
| ✅ Your code stays Apache 2.0 | In every version already released — forever |
| ✅ You can use your own contribution anywhere | It's still yours |
| ⚠️ The project may sublicense it | So a future licensing decision doesn't require tracking down every past contributor |

> [!NOTE]
> **Why a CLA and not just a DCO?** A DCO certifies you had the right to submit
> your code. It does not let the project make licensing decisions later without
> the written consent of every contributor. A CLA does — which is the difference
> between a project that can adapt and one that's frozen by its own history.
>
> This is not a plan to close the source. Apache 2.0 is irrevocable for every
> version already published; nothing can take that back.

### Contributing on behalf of an employer

If you're contributing as part of your job, make sure your employer has approved
it. If they need a Corporate CLA, open a
[discussion](https://github.com/Fluxify-rest/Fluxify/discussions).

- **Title** clearly summarises the change.
- **Description** covers the *why* and the *what* — enough for a reviewer to
  understand without reading every line.
- **Scope** is one logical change. Split unrelated work into separate PRs.
- **Checks pass**: `bun run lint`, `bun run security:scan`, and the test suites
  relevant to your change.
- **Docs updated** if you changed behaviour a user would notice.

---

## Troubleshooting

**`bun run dev` exits with "WORKER_PROJECT_ID is required"**
The compiled worker needs a project to serve. See
[Step 6](#step-6-create-a-project-and-start-the-worker).

**Routes save but never become reachable**
NATS is running without JetStream. Restart it with `-js` — the bundled compose
file already does this.

**"Module not found: Can't resolve 'child_process'" in the web app**
You imported from the root of `@fluxify/server`, which pulls in the whole server
barrel file. Use a deep import for utilities
(`@fluxify/server/src/lib/acl`) and `import type` for types.

**Worker starts and then fails every request**
`MASTER_ENCRYPTION_KEY` differs between the control plane and the worker.
Project configuration reaches the worker encrypted with it, so both must match.

**Integration tests can't reach Docker**
Set `DOCKER_HOST` — see [Step 4](#step-4-configure-environment).

---

Thank you for helping build Fluxify! 🚀
