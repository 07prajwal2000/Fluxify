# Contributing to Fluxify

Welcome! Fluxify is an open-source low-code agentic backend platform, built as a
Bun monorepo. Code fixes, new workflow blocks, security hardening, and
documentation improvements are all welcome.

This guide takes you from a fresh clone to a running stack, and shows where to
put your change.

> [!WARNING]
> **Alpha software.** Architecture, internal APIs, and features change quickly.
> For anything substantial, open an issue or discussion first so you don't build
> something that's about to move.

> [!TIP]
> **Pre-commit hooks are automatic.** `bun install` registers a Git hook via
> `scripts/setup-hooks.ts`. Every commit runs linting, complexity analysis
> (`fta-cli`), and the unit tests.

> [!IMPORTANT]
> **Contributing accepts our CLA.** There is nothing to sign — opening a pull
> request is your acceptance. You keep ownership of your work. See
> [Contributor License Agreement](#contributor-license-agreement) below.

---

## Contents

1. [Quickstart](#quickstart)
2. [Prerequisites](#prerequisites)
3. [Setup, step by step](#setup-step-by-step)
4. [How Fluxify fits together](#how-fluxify-fits-together)
5. [Run only what you're touching](#run-only-what-youre-touching)
6. [Where to put your change](#where-to-put-your-change)
7. [Testing](#testing)
8. [Command reference](#command-reference)
9. [Git workflow & pull requests](#git-workflow--pull-requests)
10. [Contributor License Agreement](#contributor-license-agreement)
11. [Troubleshooting](#troubleshooting)

---

## Quickstart

```bash
# 1. Fork https://github.com/Fluxify-rest/Fluxify, then clone your fork
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify

# 2. Install dependencies (also registers the pre-commit hook)
bun install

# 3. Start PostgreSQL, Valkey, NATS, Caddy and the telemetry backends
docker compose up -d

# 4. Create your environment file — the defaults work locally
cp env.example .env

# 5. Create the database tables
bun run db:migrate

# 6. Start everything
bun run dev
```

Open <http://localhost:8080/_/admin/ui> and log in with `admin@company.com` /
`admin@123` (the `SEED_USER_*` values in `.env`).

---

## Prerequisites

| Tool | Minimum version | Purpose |
| :--- | :--- | :--- |
| **Bun** | `v1.4.2+` | Runtime and workspace package manager ([install](https://bun.sh)) |
| **Docker** | `v20.10+` | The backing services in `docker-compose.yml` |
| **Git** | `v2.30+` | Version control and the pre-commit hook |
| **GitHub CLI (`gh`)** | `v2.0+` | Optional, handy for PRs and issues |

> [!IMPORTANT]
> **Use `bun`, never `npm`/`yarn`/`pnpm`.** The workspace layout, lockfile, and
> scripts all assume Bun.

---

## Setup, step by step

### 1. Fork and clone

Fork the repository on GitHub, then clone **your fork** (see the
[Quickstart](#quickstart)). Add the original repository as `upstream` so you can
stay in sync:

```bash
git remote add upstream https://github.com/Fluxify-rest/Fluxify.git
```

### 2. Install dependencies

```bash
bun install
```

### 3. Start the backing services

```bash
docker compose up -d
```

| Service | Port | What it is |
| :--- | :--- | :--- |
| PostgreSQL | `5432` | The platform database |
| Valkey | `6379` | Cache (Redis compatible) |
| NATS | `4222` | Event bus. Runs with JetStream (`-js`), which compiling routes needs |
| Caddy | `8080` | Local entry point that routes to the apps below |
| OpenObserve | `5080` | Log viewer (login `root@example.com` / `Root@Example123`) |
| Phoenix | `6006` | LLM trace viewer (OTLP gRPC on `4317`) |

> [!IMPORTANT]
> If you point at your own NATS, start it with `-js` and the same token as
> `NATS_TOKEN`, or nothing will compile.

### 4. Configure the environment

Every app in the monorepo reads one root `.env`:

```bash
cp env.example .env
```

The defaults match the compose file, so a local run needs no edits. Worth
knowing:

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `PG_URL` | `postgres://postgres:postgres@localhost:5432/fluxify_alpha` | Matches the compose file |
| `NATS_URL` / `NATS_TOKEN` | `nats://localhost:4222` / `fluxify_nats_token` | Token must match the compose file |
| `WORKER_PROJECT_ID` | `*` | Serve every project. Set a project id to pin the worker to one |
| `MASTER_ENCRYPTION_KEY` | a sample key | Encrypts stored credentials. The control plane and workers must share it |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | `admin@company.com` / `admin@123` | The first admin login |
| `DOCKER_HOST` | Windows named pipe | On Linux/macOS use `unix:///var/run/docker.sock`. Only needed for the orchestrator and container-based tests |

### 5. Create the database tables

```bash
bun run db:migrate
```

### 6. Start everything

```bash
bun run dev
```

Saving a route in the editor compiles it, and the worker picks it up in place.
There is no restart.

### 7. Open it

| Surface | URL |
| :--- | :--- |
| Admin dashboard (visual editor) | <http://localhost:8080/_/admin/ui> |
| Admin REST API | <http://localhost:8080/_/admin/api> |
| OpenAPI documentation | <http://localhost:8080/_/admin/api/openapi/ui> |
| Your workflow endpoints | <http://localhost:8080/> |
| Docs site | <http://localhost:5173> |
| OpenObserve (logs) | <http://localhost:5080> |
| Phoenix (LLM traces) | <http://localhost:6006> |

Behind Caddy, each app also listens on its own port: dashboard `3000`, server
`5500`, request worker `5600` (health on `5601`), AI gateway `8001`.

> [!NOTE]
> **Why the `/_/admin` prefix?** It keeps platform management and the visual
> builder apart from the root path `/`, which is free for the APIs users build,
> so their routes can never collide with ours.

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

## Run only what you're touching

You rarely need the full stack. Run just the part you're changing:

| Focus area | Command | What it starts |
| :--- | :--- | :--- |
| **Full stack** | `bun run dev` | Server, worker, dashboard, AI gateway, docs |
| **Backend server** | `bun run dev:server` | `apps/server` control plane, watch mode |
| **Request worker** | `bun run dev:worker` | Compiled worker |
| **Legacy worker** | `bun run dev:worker:dag` | Graph interpreter, for comparison only |
| **Dashboard** | `bun run dev:portal` | `apps/portal` (Vite) |
| **AI gateway** | `bun run dev:ai` | `apps/ai-gateway` |
| **Documentation** | `bun run dev:docs` | VitePress site |

---

## Where to put your change

| Path | Workspace | What lives there |
| :--- | :--- | :--- |
| `apps/server` | `@fluxify/server` | Admin API, compiler, request workers, database schema |
| `apps/portal` | `@fluxify/portal` | The admin dashboard, including the AI assistant UI |
| `apps/web` | `@fluxify/web` | The older Next.js dashboard, being replaced by `apps/portal` |
| `apps/ai-gateway` | `@fluxify/ai-gateway` | AI agent harness, LLM providers, MCP tooling |
| `packages/blocks` | `@fluxify/blocks` | Block definitions, schemas, runtime actions, compiler emitters |
| `packages/lib` | `@fluxify/lib` | Execution engine, VM, state runtime |
| `packages/adapters` | `@fluxify/adapters` | Database, API, and cloud service integrations |
| `packages/common` | `@fluxify/common` | Shared utilities, logging, constants |
| `docker/` | — | Dockerfiles and compose files for the Kit and production images |
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
| **Dashboard** | `bun run test:portal` | `apps/portal` tests |
| **AI gateway** | `bun run test:ai-gateway` | `apps/ai-gateway` tests |
| **All unit** | `bun run test:unit` | Fast unit tests across every package |
| **All integration** | `bun run test:integration` | Every integration suite |
| **End to end** | `bun run test:e2e` | `testing/e2e` (needs the full stack) |

File naming decides which suite a test lands in:

- `*.test.ts` → integration tests
- `*.spec.ts` → unit tests

Before opening a PR, manually exercise the parts you changed. The pre-commit
hook runs linting, analysis, and the unit tests.

---

## Command reference

| Command | Description |
| :--- | :--- |
| `bun run dev` | All development servers concurrently |
| `bun run dev:server` | Backend control plane, watch mode |
| `bun run dev:worker` | Compiled request worker, watch mode |
| `bun run dev:worker:dag` | Legacy graph interpreter worker |
| `bun run dev:portal` | Admin dashboard |
| `bun run dev:ai` | AI gateway |
| `bun run dev:docs` | VitePress docs with live reload |
| `bun run build` | Production bundles for every package and app |
| `bun run lint` | Lint everything via Turborepo |
| `bun run analyze` | Static analysis & complexity scoring (`fta-cli`) |
| `bun run test:*` | See [Testing](#testing) |
| `bun run db:generate` | Generate a new Drizzle migration |
| `bun run db:migrate` | Apply the schema to PostgreSQL |
| `bun run docs:build` | Build the documentation site |
| `bun run docs:preview` | Preview the built documentation site |

---

## Git workflow & pull requests

### Branch naming

Always work in a branch off `main`:

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

Opening a PR also accepts our CLA — see below. There's nothing to do in advance.

### What a good PR looks like

- **Title** follows the conventional format, e.g. `feat(server): add X` or
  `fix(portal): correct Y`.
- **Description** covers the *why* and the *what* — enough for a reviewer to
  understand without reading every line. Link the issue (`Closes #123`).
- **Scope** is one logical change. Split unrelated work into separate PRs.
- **Checks pass**: `bun run lint` and the test suites relevant to your change.
- **Docs updated** if you changed behaviour a user would notice.

---

## Contributor License Agreement

Fluxify is licensed under the [Apache License 2.0](LICENSE), except its
Enterprise Edition code, which is under the
[Fluxify Enterprise Edition License](LICENSE_EE). Enterprise Edition code is
every file in a directory named `ee` and every file whose name contains `.ee.`
(for example `connector.ee.ts`). Contributions to either are covered by our
[Contributor License Agreement](CLA.md).

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
| ⚠️ Enterprise Edition contributions are not Apache 2.0 | They ship under the Enterprise Edition License. The project owner — and any company later formed to run Fluxify — can use, relicense, and sell them without asking you or paying you |

> [!IMPORTANT]
> **Touching an `ee/` directory or a `*.ee.*` file?** That code is
> source-available, not open source. By contributing to it you grant the
> project owner full rights to use and commercialize your change. If you don't
> want that, keep your change outside Enterprise Edition code.

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

---

## Troubleshooting

**`bun run dev` exits with "WORKER_PROJECT_ID is required"**
Your `.env` has no `WORKER_PROJECT_ID`. Copy the value from `env.example`
(`WORKER_PROJECT_ID=*`), or set a project id.

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
Set `DOCKER_HOST` in `.env` — see [Step 4](#4-configure-the-environment).

---

Want to run the published Docker images instead of the source? See the
[Kit](https://docs.fluxify.rest/deployments/kit) and [Production](https://docs.fluxify.rest/deployments/production) guides.

Thank you for helping build Fluxify! 🚀
