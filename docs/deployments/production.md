---
title: Production Setup (Admin + Workers)
description: Deploy Fluxify for production with a separate control plane and replicated request workers behind Traefik. Includes a ready-to-use Docker Compose stack.
---

# Production Setup (Admin + Workers)

For production, Fluxify splits into two roles so you can scale request handling
without touching the control plane:

| Role | Image | Responsibility |
| :--- | :--- | :--- |
| **Admin** | `fluxify-admin` | Control plane — dashboard, admin API, AI gateway. Owns the database and prepares your routes for the workers. Run **one**. |
| **Orchestrator** | `fluxify-orchestrator` | Starts and stops the worker containers for you. Holds the Docker socket; runs none of your code. Run **one** (a second one stands by). |
| **Worker** | `fluxify-worker` | Serves your published API. Holds no database connection. **Run many** — the orchestrator creates them. |

All three are published to the GitHub Container Registry under
`ghcr.io/fluxify-rest/`.

An edge proxy (**Traefik**) sits in front and sends admin traffic to the admin
container and everything else to the workers.

> [!TIP]
> This guide runs the workers on one Docker host. To run them on a Kubernetes
> cluster instead, see [Install on Kubernetes](./kubernetes/install).

### Which tag to pull {#image-tags}

Every release tags all three images together, so admin, orchestrator and worker
always come from the same build. Never mix versions between them.

| Tag | What it is |
| :--- | :--- |
| `%%RELEASE_TAG%%` | One exact release. **Pin this** for anything you care about. |
| `alpha` | Moves to the newest pre-release. Convenient while Fluxify is pre-1.0. |
| `latest` | The newest stable release. **Does not exist yet** — the first 1.0 release creates it. |

> [!WARNING]
> Fluxify is pre-1.0, so every release is a pre-release and `latest` is not
> published. Use `alpha`, or a pinned version tag.

> [!TIP]
> Just prototyping or testing? The all-in-one [Kit image](./kit) is simpler.
> Anything in production belongs here, even on a single machine.

---

## Why Traefik here? {#why-traefik}

The production stack runs **multiple** worker containers and load-balances across
them. Traefik discovers each worker automatically from its Docker labels and
spreads traffic across every replica with no manual list to maintain — add or
remove workers and routing updates itself. The Kit image uses a simpler built-in
proxy because it only ever has one of each service.

---

## Who starts the workers {#orchestrator}

You don't. There is no `worker` service in the compose file — the
**orchestrator** creates worker containers, and compose runs only the
infrastructure around them.

The reason is that hand-writing a worker service is easy to get wrong in a way
nothing tells you about: its settings are a project id, a mode and a list of
group ids, and a misplaced one produces a worker that starts happily and serves
the wrong things. So you describe what you want instead — "this project wants a
workflow node for these groups, two of them" — and the orchestrator creates the
containers, labels them for Traefik, and removes them when you stop asking for
them.

That request is called a **claim**. A fresh stack seeds one automatically: a
single node serving every project and doing both jobs, which is exactly what the
old `worker` service was. Set `ORCHESTRATOR_SEED_DEFAULT_CLAIM=false` in your
`.env` to start with no workers at all.

Ownership is split cleanly, because two things managing the same container will
fight over it:

- **compose owns** nats, postgres, valkey, traefik, admin, orchestrator, and
  the one [development worker](#dev-workers)
- **the orchestrator owns** every production worker

> [!WARNING]
> `docker compose ... --remove-orphans` deletes the orchestrator's workers.
> Compose has no idea they were never its containers. They come back on the next
> reconcile pass (about five seconds) as long as the orchestrator is running.

Two other things worth knowing:

- **A license that lapses does not take your traffic down.** Running workers
  keep running; only a restart is refused. Fix the licence and nothing had to
  fail in the meantime.
- **Killing the orchestrator does not stop your API.** Workers are not its
  children — they are separate containers with Docker's own restart policy. You
  can restart or upgrade the control plane while traffic keeps being served.

For how any of that actually works — the leader lease, the reconcile loop, what
forces a container to be replaced — see
[The Orchestrator](/architecture/orchestrator).

---

## Architecture

```mermaid
flowchart TB
    C(["Client / API traffic"]) --> T["Traefik :80"]
    T -->|"/_/admin*, /.well-known/oauth-*"| A["Admin container<br/>dashboard · admin API<br/>AI gateway · MCP"]
    T -->|"project-a.example.com"| WA1["Worker A"] & WA2["Worker A"]
    T -->|"project-b.example.com"| WB1["Worker B"] & WB2["Worker B"]

    A --> PG[("PostgreSQL")]
    A --> N["NATS"]
    N -.->|"prepared routes"| WA1 & WA2 & WB1 & WB2
    A --> V["Valkey"]
    WA1 & WA2 & WB1 & WB2 --> V

    style C fill:#111113,stroke:#EF4444,color:#FAFAFA
    style A fill:#111113,stroke:#D2FF4D,color:#FAFAFA
    style WA1 fill:#111113,stroke:#10B981,color:#FAFAFA
    style WA2 fill:#111113,stroke:#10B981,color:#FAFAFA
    style WB1 fill:#111113,stroke:#D2FF4D,color:#FAFAFA
    style WB2 fill:#111113,stroke:#D2FF4D,color:#FAFAFA
    style PG fill:#111113,stroke:#F59E0B,color:#FAFAFA
```

Only the admin container connects to PostgreSQL. Workers receive your routes
ready to run over NATS — see
[Request Lifecycle](/architecture/request-lifecycle).

Workers only receive traffic once they report **ready**. Traefik health-checks
each replica and holds traffic back until its routes have loaded.

---

## Which projects a worker serves {#projects}

A fresh stack starts **one worker that serves every project**. That is the
default claim, and its worker runs with `WORKER_PROJECT_ID=*`. It picks up new
projects as you create them, with no restart and no id to copy.

To give a project workers of its own, add a claim in the project's
**Orchestration** settings. Copies of one claim's worker always share a project,
so:

- More traffic for a project → **more replicas** on that project's claim.
- Another project with its own workers → **another claim**.

Because your routes own the whole URL path space, projects are told apart by
**hostname**, not by path prefix:

- The shared worker answers on every host. Two projects that use the same path
  on the bare domain collide, and only one of them answers.
- A project's own worker is reached only on the project's host. Set the base
  domain in **Instance settings → Hosting** and a subdomain in
  **Project settings → General**, and point that name's DNS at Traefik. A claim
  that serves APIs is refused for a project with no subdomain.

How many workers you may run at all depends on your edition. See
[Workers per edition](./editions#workers).

---

## What a worker runs {#worker-mode}

By default a worker does everything: it serves your project's HTTP routes and it
runs that project's background workflows. That is the right setup for most
deployments, and it needs no configuration.

Pick a claim's **type** when you want to separate the two. The orchestrator
passes it to the claim's workers as `WORKER_MODE`, so don't set that yourself:

| Type (`WORKER_MODE`) | Serves routes | Runs workflows |
| --- | --- | --- |
| `both` *(default)* | yes | yes |
| `route` | yes | no |
| `workflow` | no | yes |

Splitting them is worth doing when background work is heavy enough to compete
with traffic: give workflows their own worker service and the request workers
stop sharing a CPU budget with a five-minute report build. It is the same worker
image either way — only the setting differs. The non-commercial edition's two
workers are enough for exactly this: one `route` and one `workflow`.

> [!IMPORTANT]
> **All workers for one project must use the same mode.** A worker that finds
> another mode already running for its project refuses to start and says so,
> rather than joining in and running every workflow twice. To split a project,
> change every worker of that project at once.

An unrecognised value is rejected at boot instead of being treated as the
default — a typo should not silently change what a machine runs.

### Running triggers on their own workers {#trigger-groups}

Triggers belong to [groups](/concepts/triggers#groups). Pick groups on a
`workflow` claim and its workers run only the triggers in those groups (the
orchestrator passes them as `WORKER_GROUP_ID`). A claim with no groups runs
every group — the default.

This is how a busy trigger gets machines of its own: put it in a group, and
give that group a claim of its own. Routes and queued jobs are not
affected by this setting; it only decides which triggers a worker listens to.

> [!NOTE]
> Moving a trigger to another group moves it between workers: the old worker
> stops reading it and the new one starts.

---

## Experimental CPU-stall protection

Compiled workers normally run with no execution-watchdog overhead. To enable
CPU-stall containment for one project, save this project setting through the
admin API:

```text
experimental.workerTimeouts.enabled = true
```

The setting is published through NATS and takes effect without redeploying or
restarting the container. When enabled, each route's `timeoutSeconds` defaults
to 30 seconds and may be increased. A route is terminated only when its event
loop is blocked past that budget; long asynchronous work remains running while
the execution process continues to heartbeat. The supervisor then replaces only
the isolated execution process, so the container and its NATS watcher stay up.

---

## Request body size {#request-body-size}

Every request body a route receives is capped. The default is **8 MB**, and a
request above it is rejected with `413` before any workflow runs.

```env
# Kilobytes. 8192 = 8 MB (the default).
WORKER_MAX_STREAM_SIZE=8192
```

Set it in the same `.env` the workers read (see [Step 1](#env)), or per service
in your compose file. Raise it deliberately: the whole body is held in memory
while the route runs, so the cap multiplied by your concurrency is memory the
worker has to have.

::: warning Fluxify is an API server, not an upload service
Routing large files through your API means the upload is paid for twice — once
into the worker, once out of it — and every megabyte competes with the requests
you actually want to serve.

For file uploads, have your client upload **directly to object storage** with a
pre-signed URL: your route issues a short-lived signed S3 (or compatible) URL,
the client `PUT`s the file straight to storage, then calls your API again with
the resulting object key. Only the key ever passes through Fluxify.
:::

---

## Scheduled run limit {#schedule-horizon}

A [Trigger Workflow](/blocks/trigger-workflow#running-later) block can hold a
run for later. Each held run is kept by NATS until its time comes, so how far
ahead a run may be scheduled is a deployment decision. The default is **30
days**; a block asking for a later time fails with an error.

```env
# How far ahead a run may be scheduled. Hours, minutes or seconds: 720h = 30 days (the default).
WORKER_SCHEDULE_MAX_HORIZON=720h
```

Write it as `s`, `m` and `h` — there is no day unit, so a year is `8760h`. A
value that cannot be read stops the worker at startup. Set it on the workers,
in the same `.env` they read (see [Step 1](#env)).

There is no cap on how many runs may be waiting. Each one is a small message on
your NATS server, stored for as long as it waits. If you allow a long limit on
a busy system, size your NATS storage for it: the number of runs you expect to
be waiting at once, times the size of the data each one carries.

---

## Execution history retention {#recording-retention}

A route or workflow with **Execution history** turned on saves every run: each
block's input, output, timing and whether it succeeded. Saved runs are deleted
once they are older than **30 days**. The cleanup runs once a day.

```env
# Days a recorded run is kept before it is deleted (default 30).
RECORDING_MAX_AGE_DAYS=30
```

Set it on the admin service, in the same `.env` it reads (see [Step 1](#env)).
Workers don't read it. Leaving it unset gives you the default.

::: warning Saved runs are not masked
Execution history is a debugging tool. Request bodies, values read from app
config (secrets too) and responses from other services are saved exactly as the
run saw them. Anyone who can open the run history can read them. Turn it
on while you debug, then off again.
:::

A worker hands each saved run to the admin through NATS. While the admin is
down, NATS keeps the waiting runs for up to a day and up to 512 MB; past that,
the oldest are dropped. Size your NATS storage with that in mind if many routes
record at once.

---

## AI assistant traces {#llm-tracing}

Send a trace of every AI assistant run to [Phoenix](https://phoenix.arize.com),
Langfuse or any viewer that reads OpenInference. You see each run, its model
calls and its tool calls with timings and token counts. Off by default.

```env
LLM_TRACING_ENABLED=true
# Phoenix on the Docker host. Use http://localhost:6006/v1/traces outside Docker.
LLM_OTLP_TRACES_ENDPOINT=http://host.docker.internal:6006/v1/traces
# Optional. key:value pairs split by ;
LLM_OTLP_TRACES_HEADERS=
# Share of runs traced, 0 to 1 (default 1).
LLM_TRACING_SAMPLE_RATE=1
# Default false: prompts, messages and tool inputs/outputs stay out.
LLM_TRACING_RECORD_CONTENT=false
```

Set them in the `.env` the AI assistant's service reads (see [Step 1](#env)).
See [Trace the AI assistant](/integrations/agent-tracing) for what shows up.

::: warning Content can hold secrets
With `LLM_TRACING_RECORD_CONTENT=true` the traces carry every prompt and tool
result as the assistant saw it: user data, and secrets such as password hashes
from run history. Anyone who can open the viewer can read them. Keep it `false`
outside your own machine.
:::

---

## Local async executor

Compiled workers include a bounded local executor for the future async-trigger
and workflow runtime. It is currently an internal capability rather than a
route setting or public scheduling API. It queues only I/O-oriented detached
work in the same execution process; it does not isolate CPU-heavy work.

Configure its per-worker bounds through environment variables:

```env
# Defaults shown. A full executor returns 429 for a new async submission.
ASYNC_EXECUTOR_MAX_IN_FLIGHT=10
ASYNC_EXECUTOR_MAX_QUEUE_DEPTH=100
# Graceful shutdown waits this long for accepted work before the process exits.
ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS=30000
```

Future route-to-route, webhook, cron and message-bus adapters use this same
submission boundary. Distributed workflows will use durable JetStream
scheduling instead of relying on the process-local queue.

## Admin API rate limit {#admin-rate-limit}

The admin API — everything the portal calls, plus login and user management —
is capped per signed-in user. The default is **15 requests per second**. A user
over the limit gets a `429` with a `Retry-After: 1` header, and the very next
second they are served normally again. The portal waits and retries a `429`
for you (up to 3 times), so a short burst does not show an error.

```env
# Admin API requests allowed per second, per user. 0 turns the limit off.
ADMIN_RATE_LIMIT_PER_SEC=15
```

Set it on the admin service, in the same `.env` it reads (see
[Step 1](#env)). Leaving it unset gives you the default, so an existing
deployment needs no change.

This is a guard rail for the control plane, not a traffic policy for your
projects:

- **Your API routes are not affected.** Only the admin surface is counted;
  requests to the routes you build are never capped by this setting.
- **It is counted per signed-in user**, so one busy account cannot slow the
  admin API down for your teammates.
- **Signed-out requests are not counted.** Behind a reverse proxy every
  signed-out visitor looks like the same caller, so counting them would mean
  one visitor could lock out the login page for everyone.

::: tip Why the admin API has a cap at all
The admin service is the one holding your database connection. A client stuck
in a retry loop can otherwise keep it busy enough to slow the portal down for
every project on the instance.
:::

Raise it if a team regularly works in pages that load many panels at once; ten
per second is comfortable for normal portal use. If your Redis is unreachable
the limit is skipped rather than enforced, so a Redis outage cannot lock anyone
out of the portal.

---

## Step 1 — Create your `.env` {#env}

The compose file and `env.example` live in the Fluxify repository, so clone it
first. Copy `docker/production/env.example` to `docker/production/.env` next to
the compose file. The admin, the orchestrator and every worker share the same
`.env`:

```bash
git clone https://github.com/Fluxify-rest/Fluxify.git && cd Fluxify
cp docker/production/env.example docker/production/.env
```

At minimum set these:

```env
#====================== ENVIRONMENT ======================
NODE_ENV=production
ENVIRONMENT=production

#====================== PUBLIC ADDRESS ======================
# The address people open Fluxify at. All three must be the same value, with
# the scheme and no trailing slash. Sign-in only works at this address.
SERVER_URL=https://your-domain.com
BETTER_AUTH_URL=https://your-domain.com
TRUSTED_ORIGINS=https://your-domain.com

#====================== DATABASES ======================
PG_URL=postgres://postgres:postgres@postgres:5432/fluxify_alpha
REDIS_HOST=valkey
REDIS_PORT=6379

#====================== EVENT BUS ======================
NATS_URL=nats://nats:4222
NATS_TOKEN=fluxify_nats_token

#====================== SECURITY & KEYS ======================
MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
SYSTEM_ACCESS_KEY=<openssl rand -hex 32>

#====================== FIRST-RUN ADMIN ======================
SEED_USER_EMAIL=admin@your-domain.com
SEED_USER_PASSWORD=ChangeThisPassword123!
SEED_USER_NAME=Admin User

#====================== WORKERS ======================
# The image the orchestrator creates workers from. Use the same tag as admin.
ORCHESTRATOR_WORKER_IMAGE=ghcr.io/fluxify-rest/fluxify-worker:%%RELEASE_TAG%%
```

> [!WARNING]
> **`env.example` ships sample keys.** Replace `MASTER_ENCRYPTION_KEY`,
> `BETTER_AUTH_SECRET` and `SYSTEM_ACCESS_KEY` with your own before the first
> start. Change the Postgres password and `NATS_TOKEN` too. They are also
> written in `docker-compose.yml` (`POSTGRES_PASSWORD` and NATS's `--auth`), so
> change both places to the same value.

> [!WARNING]
> Back up `MASTER_ENCRYPTION_KEY`. Losing or changing it after storing data makes
> every saved credential unreadable. Admin and workers **must** use the same
> value — your project's configuration travels to workers encrypted with it.

> [!NOTE]
> The compose file already sets `ENABLE_ADMIN=true` on the admin service and
> keeps the workers as pure executors — you don't need to set those yourself.
> `HOSTNAME` is the address the processes listen on inside the container. Leave
> it at `0.0.0.0`; it is not your domain.

### Images

The compose file **builds** admin and the orchestrator from the source you
cloned, while the orchestrator **pulls** workers from `ORCHESTRATOR_WORKER_IMAGE`.
To run released images instead, and keep all three on the same version, swap
the `build:` block for the `image:` line above it on both services, with the
same tag as `ORCHESTRATOR_WORKER_IMAGE`:

```yaml
  admin:
    image: ghcr.io/fluxify-rest/fluxify-admin:%%RELEASE_TAG%%
  orchestrator:
    image: ghcr.io/fluxify-rest/fluxify-orchestrator:%%RELEASE_TAG%%
```

### Ports and HTTPS {#ports}

| Port | What | Open it to the internet? |
| :--- | :--- | :--- |
| `8080` → Traefik `80` | The dashboard, the admin API and your APIs | Yes. Map it to `80:80` on a real server. |
| `8081` | Traefik's dashboard, with no password | **No.** Remove the port, or keep it firewalled. |

Postgres, Valkey, NATS and the workers publish no ports. Keep it that way.

Traefik here serves plain HTTP. For HTTPS, put TLS in front of it: a load
balancer or proxy that holds the certificate and forwards to Traefik, or TLS on
Traefik's `web` entry point. Then set the three URLs above to `https://`.

### Generate your secret keys

Use this generator to create secure values for `MASTER_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET`, then paste them into your shared `.env`:

<KeyGenerator />

---

## Step 2 — Start the stack {#start}

```bash
docker compose -f docker/production/docker-compose.yml up -d
```

This launches Traefik, the admin container, the orchestrator, and the Postgres /
Valkey / NATS dependencies. The admin container applies database updates on
startup, creates the seed admin, and adds the default claim: one worker that
serves every project. Within a few seconds the orchestrator starts that worker.

**Check:** `docker ps` shows a container named `fluxify-worker-…` next to the
compose services (plus `fluxify-dev-worker`, the
[development worker](#dev-workers)), and
`curl http://localhost:8080/_/admin/api/public-settings` returns `200`.

---

## Step 3 — Create your projects

1. Open `http://your-domain.com/_/admin/ui` and log in with the seed credentials.
2. **Create your projects.**

That's it: the default worker serves every project, new ones included, with no
id to copy and no restart. Saving a route in the editor publishes it to the
workers in place.

To give a project workers of its own, see
[Which projects a worker serves](#projects).

---

## Step 4 — Access

| Surface | URL |
| :--- | :--- |
| Dashboard | `http://your-domain.com/_/admin/ui` |
| Admin API | `http://your-domain.com/_/admin/api` |
| Your APIs, on the shared worker | `http://your-domain.com/` |
| A project's API, on its own workers | `http://<project subdomain>.your-domain.com/` |

---

## Connecting AI clients (MCP) {#mcp}

Fluxify has an MCP server, so AI apps and coding agents can work with your
projects. Point the client at:

```
https://your-domain.com/_/admin/mcp
```

The client signs in as a Fluxify user, and you approve it in the browser. It
gets the same access that user has. For sign-in to work, these addresses go to
Fluxify on the same port as everything else:

| URL | What it is |
| :--- | :--- |
| `/_/admin/mcp` | The MCP server |
| `/.well-known/oauth-protected-resource` | Tells the client where to sign in |
| `/.well-known/oauth-authorization-server` | The sign-in details |

Only paths starting with `/.well-known/oauth-` are taken for this. Any other
`/.well-known/...` path still reaches your own routes.

> [!IMPORTANT]
> **Cloud AI apps need a public HTTPS address.** claude.ai and ChatGPT connect
> from their own servers, not from your computer, so they can't reach
> `localhost` or a private network. Your instance must be reachable from the
> internet over `https://`. Apps running on the
> server itself can use `http://localhost:8080`.

> [!WARNING]
> **Use HTTPS on any address other than `localhost`.** On such an address,
> Fluxify tells MCP clients to sign in over `https://`, even when it is served
> over plain `http://`. Without HTTPS, sign-in fails.

**Check:** replace `<url>` with your address.

```bash
curl -i -X POST <url>/_/admin/mcp                                    # 401, with a WWW-Authenticate header
curl <url>/.well-known/oauth-protected-resource/_/admin/mcp          # JSON
curl <url>/.well-known/oauth-authorization-server/_/admin/api/auth   # JSON
```

The `401` is expected: it means the MCP server is up and asks the client to
sign in. The JSON lists your public address. If it shows another one, fix
`SERVER_URL`, `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` in your `.env`.

---

## Scaling the workers {#scaling}

Raise the replica count on the claim that needs more workers. A project's
claims are in its **Orchestration** settings, and the claim that serves every
project is in the instance's. The orchestrator starts the extra workers on its
next pass, and Traefik picks them up on its own, with no proxy change needed.
Workers hold no state, so you can scale up and down freely, up to the node
pool's ceiling.

Each claim also sets **how much CPU and memory each of its workers may use**.
The default is 1 core and 1024 MB, adjustable in steps of 0.5 core and 256 MB.
On Docker that is the container's limit. Resizing a claim replaces its workers
one at a time. See [Sizing a worker](./kubernetes/#sizing) for the full ranges.

> [!TIP]
> **Scale out with replicas.** Each worker container has one isolated execution
> process, so replicas add capacity without competing for the same CPU budget.

> [!IMPORTANT]
> Scale **workers**, not the admin. Keep a single admin container so database
> updates and the seed step run exactly once.

### Development workers {#dev-workers}

A worker started with `FLUXIFY_ENV=development` is a **development worker**.
It runs only development work, never production's, and it serves every project
in both modes, so `WORKER_PROJECT_ID`, `WORKER_MODE` and `WORKER_GROUP_ID` are
ignored on it. It does not use a license slot (see
[Workers per edition](./editions#workers)), and it needs no claim. See
[Environments](../concepts/environments).

The compose file starts one for you, as the `worker-dev` service
(container `fluxify-dev-worker`). It uses the same image as the production
workers, `ORCHESTRATOR_WORKER_IMAGE`, and is not an orchestrator claim: the
orchestrator does not create, resize or remove it. It is also the only worker
that is a compose service, so `--remove-orphans` leaves it alone.

- **No route to it yet.** Traefik has no rule for it, so it takes no web
  traffic. Nothing is sent to the development environment yet, so it has no
  routes to serve for now.
- **Its settings are fixed.** It gets the NATS, Valkey and encryption-key
  settings from your `.env`, and nothing else; in particular no database
  address.
- **Don't put `FLUXIFY_ENV=development` in `.env`.** Admin and every production
  worker read that file, so it would turn them all into development workers.
  Leave the setting where the compose file puts it, on `worker-dev` only.
- **Don't want it?** Delete the `worker-dev` service from the compose file.

---

## Database integration idle timeout

Compiled workers share database clients across requests. To avoid retaining a
pool for an integration that has gone quiet, set
`INTEGRATION_TIMEOUT_POLICY_IN_SEC` in `docker/production/.env`:

```env
INTEGRATION_TIMEOUT_POLICY_IN_SEC=450
```

`450` is the default and means 7.5 minutes. When an integration has no
in-flight request or transaction for that period, its PostgreSQL, MySQL, or
MongoDB client closes. The next request opens a fresh client. This never closes
a client while a request is using it; choose a larger value when avoiding a
connection cold-start matters more than releasing idle sockets.

---

## Health checks

Point your load balancer and orchestrator at port **5601**, not 5600:

| Probe | URL (port 5601) | Means |
| :--- | :--- | :--- |
| Startup | `/_/admin/api/healthchecks/startup` | The worker process is up |
| Readiness | `/_/admin/api/healthchecks/ready` | Your routes are loaded — safe to send traffic |

Port 5600 carries your API traffic. A probe sent there can be answered by any
one of the worker's internal handlers, so it can't tell you the whole container
is healthy. The bundled compose file already targets 5601.

---

## Upgrading

```bash
docker compose -f docker/production/docker-compose.yml pull
docker compose -f docker/production/docker-compose.yml up -d
```

Back up Postgres first. Roll the admin first: on startup it updates the database
to the new version, then the workers follow automatically. On the default
compose file, which builds admin and the orchestrator from source, pull the new
source and add `--build` to `up -d` instead. Either way, move
`ORCHESTRATOR_WORKER_IMAGE` to the same version.

::: info If a database update fails
The admin stops, and its log says `database migration failed` with the reason.
The update is all or nothing, so the database is left exactly as it was: fix the
cause, or go back to the previous version, and start the admin again.
:::

---

## Troubleshooting

**No `fluxify-worker…` container ever appears**
Check the orchestrator's logs: `docker logs fluxify-orchestrator`. The usual
causes are a missing Docker socket mount, `ORCHESTRATOR_WORKER_IMAGE` naming an
image that cannot be pulled, or `ORCHESTRATOR_SEED_DEFAULT_CLAIM=false` with no
claim added since. A claim that asks for more workers than your
[edition](./editions#workers) or the node pool allows waits as pending, and its
Orchestration page says why.

**Traffic returns 404 for `/_/admin` pages**
Traefik routes by path priority. Confirm the admin service still carries its
`PathPrefix(/_/admin)` label and that the container is running.

**An MCP client can't sign in, or `/.well-known/oauth-…` returns 404**
The admin service's label must also match `PathPrefix(/.well-known/oauth-)`,
as in the compose file. If the JSON from the [MCP checks](#mcp) shows an
`http://` or wrong address, fix `SERVER_URL`, `BETTER_AUTH_URL` and
`TRUSTED_ORIGINS`, and serve Fluxify over HTTPS.

**Workers never receive traffic**
They stay out of rotation until the readiness check passes. Check a worker's
logs — a `NATS_TOKEN` mismatch or a missing `MASTER_ENCRYPTION_KEY` is the usual
cause. You can hit the probe directly from inside the network at
`/_/admin/api/healthchecks/ready` on port **5601**.

**A worker exits immediately on start**
It refuses to run without `WORKER_PROJECT_ID` or `MASTER_ENCRYPTION_KEY`, and
says which one is missing in its logs. Both come from your shared `.env`. A
`WORKER_MODE` that is not `route`, `workflow` or `both` stops it the same way.

**A second worker for a project will not start, complaining about a consumer**
Two workers on one project are set to different modes. See
[What a worker runs](#worker-mode) — every worker for a project has to agree.
This is deliberate: the alternative is both of them running the same background
job.

**Routes save fine but never reach the workers**
NATS needs JetStream enabled (`-js`) and version 2.14 or newer. The bundled
compose file does both; if you brought your own NATS, add the flag and check
the version. On an older NATS, Fluxify exits at start saying it is too old.

JetStream also backs two KV buckets, both created on demand — nothing to
provision by hand, but they are what the `-js` flag is for:

| Bucket | Holds |
| --- | --- |
| `fluxify_artifacts` | Compiled routes and workflows, so a worker runs them without a database. |
| `fluxify_config` | Instance settings and other cross-node config, so a flag change reaches every process. |

`fluxify_config` is a distribution layer, not storage — Postgres remains the
source of truth, and the admin container rebuilds the bucket from it on every
start. Losing the NATS volume is therefore recoverable: restart admin and the
bucket comes back.

**The admin container exits at start complaining about instance settings**
Config is a hard dependency, not a degradable one, so a process that cannot
reach NATS KV exits rather than come up half-configured and authenticate people
against nothing. Check `NATS_URL`, `NATS_TOKEN`, and that JetStream is enabled.

**Traefik can't see the services**
Traefik reads Docker labels through the mounted Docker socket. Ensure the socket
volume is present and the services share the same network as Traefik.
