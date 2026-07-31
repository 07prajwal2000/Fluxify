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
| **Worker** | `fluxify-worker-compiled` | Serves your published API. Holds no database connection. **Run many.** |

An edge proxy (**Traefik**) sits in front and sends admin traffic to the admin
container and everything else to the workers.

> [!TIP]
> Just evaluating Fluxify or running it on a single machine? The all-in-one
> [Kit image](./kit) is simpler. Come back here when you need to scale.

---

## Why Traefik here? {#why-traefik}

The production stack runs **multiple** worker containers and load-balances across
them. Traefik discovers each worker automatically from its Docker labels and
spreads traffic across every replica with no manual list to maintain — add or
remove workers and routing updates itself. The Kit image uses a simpler built-in
proxy because it only ever has one of each service.

---

## Architecture

```mermaid
flowchart TB
    C(["Client / API traffic"]) --> T["Traefik :80"]
    T -->|"/_/admin*"| A["Admin container<br/>dashboard · admin API<br/>AI gateway"]
    T -->|"project-a.example.com"| WA1["Worker A"] & WA2["Worker A"]
    T -->|"project-b.example.com"| WB1["Worker B"] & WB2["Worker B"]

    A --> PG[("PostgreSQL")]
    A --> N["NATS"]
    N -.->|"prepared routes"| WA1 & WA2 & WB1 & WB2
    A --> V["Valkey"]
    WA1 & WA2 & WB1 & WB2 --> V

    style C fill:#ffe8e8,stroke:#d9534f,color:#1a1a2e
    style A fill:#f4f2ff,stroke:#5f67ee,color:#1a1a2e
    style WA1 fill:#eefaf2,stroke:#2b9d5b,color:#1a1a2e
    style WA2 fill:#eefaf2,stroke:#2b9d5b,color:#1a1a2e
    style WB1 fill:#e6f2ff,stroke:#3a7bd5,color:#1a1a2e
    style WB2 fill:#e6f2ff,stroke:#3a7bd5,color:#1a1a2e
    style PG fill:#fff8e6,stroke:#d9a441,color:#1a1a2e
```

Only the admin container connects to PostgreSQL. Workers receive your routes
ready to run over NATS — see
[Request Lifecycle](/architecture/request-lifecycle).

Workers only receive traffic once they report **ready**. Traefik health-checks
each replica and holds traffic back until its routes have loaded.

---

## One worker group per project {#projects}

This is the main thing to plan for. **A worker serves exactly one project.**

Copies of the same worker service share their settings, so they always share a
project. That means:

- More traffic for a project → **more replicas** of that project's worker service.
- Another project → **another worker service**, with its own project id.

The bundled compose file ships two worker services as a worked example —
`worker-project-a` and `worker-project-b`, two replicas each. Copy the pattern to
add a third.

Because your routes own the whole URL path space, projects are told apart by
**hostname**, not by path prefix. The example uses `project-a.localhost` and
`project-b.localhost`; point real hostnames at the stack for production.

---

## Step 1 — Create your `.env` {#env}

Copy `docker/production/env.example` to `docker/production/.env` next to the
compose file. The admin and every worker share the same `.env`:

```bash
cp docker/production/env.example docker/production/.env
```

At minimum verify the key environment variables:

```env
#====================== ENVIRONMENT ======================
NODE_ENV=production
ENVIRONMENT=production

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
BETTER_AUTH_URL=https://your-domain.com

#====================== FIRST-RUN ADMIN ======================
SEED_USER_EMAIL=admin@your-domain.com
SEED_USER_PASSWORD=ChangeThisPassword123!
SEED_USER_NAME=Admin User

#====================== PROJECTS SERVED BY WORKERS ======================
# Fill these in at Step 3, once the projects exist.
PROJECT_A_ID=
PROJECT_B_ID=
```

> [!WARNING]
> Back up `MASTER_ENCRYPTION_KEY`. Losing or changing it after storing data makes
> every saved credential unreadable. Admin and workers **must** use the same
> value — your project's configuration travels to workers encrypted with it.

> [!NOTE]
> The compose file already sets `ENABLE_ADMIN=true` on the admin service and
> keeps the workers as pure executors — you don't need to set those yourself.

### Generate your secret keys

Use this generator to create secure values for `MASTER_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET`, then paste them into your shared `.env`:

<KeyGenerator />

---

## Step 2 — Start the control plane {#start}

```bash
docker compose -f docker/production/docker-compose.yml up -d
```

This launches Traefik, the admin container, and the Postgres / Valkey / NATS
dependencies. The admin container applies database updates on startup.

The worker services will not start yet — they need a project id, and there isn't
one on a fresh install. Compose tells you so directly:

```
set PROJECT_A_ID in docker/production/.env
```

---

## Step 3 — Create your projects, then start the workers

1. Open `http://your-domain.com/_/admin/ui` and log in with the seed credentials.
2. **Create your projects.**
3. Copy each project's id from its settings page into `docker/production/.env`:

   ```env
   PROJECT_A_ID=<first-project-id>
   PROJECT_B_ID=<second-project-id>
   ```

4. Bring the stack up again:

   ```bash
   docker compose -f docker/production/docker-compose.yml up -d
   ```

The workers start and begin serving as soon as your routes reach them.

> [!TIP]
> This is a one-time step per project. From here on, saving a route in the editor
> publishes it to every worker in place — no restart, no redeploy.

---

## Step 4 — Access

| Surface | URL |
| :--- | :--- |
| Dashboard | `http://your-domain.com/_/admin/ui` |
| Admin API | `http://your-domain.com/_/admin/api` |
| Project A's API | `http://project-a.your-domain.com/` |
| Project B's API | `http://project-b.your-domain.com/` |

---

## Scaling the workers {#scaling}

Raise the replica count for the project that needs it, in the compose file:

```yaml
  worker-project-a:
    deploy:
      replicas: 4   # was 2
```

Then apply it:

```bash
docker compose -f docker/production/docker-compose.yml up -d
```

Traefik picks up the new replicas automatically — no proxy change needed.
Workers hold no state, so you can scale up and down freely.

> [!TIP]
> **Scale out, not up.** Add replicas rather than raising `WORKER_THREADS`.
> A worker container is sized for roughly one CPU; extra threads inside one
> container split that same CPU while each pays its own memory overhead.

> [!IMPORTANT]
> Scale **workers**, not the admin. Keep a single admin container so database
> updates and the seed step run exactly once.

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

Roll the admin first (it applies any database updates), then the workers follow
automatically.

---

## Troubleshooting

**Compose refuses to start with `set PROJECT_A_ID …`**
Expected on a first install — see [Step 3](#step-3-create-your-projects-then-start-the-workers).

**Traffic returns 404 for `/_/admin` pages**
Traefik routes by path priority. Confirm the admin service still carries its
`PathPrefix(/_/admin)` label and that the container is running.

**Workers never receive traffic**
They stay out of rotation until the readiness check passes. Check a worker's
logs — a `NATS_TOKEN` mismatch or a missing `MASTER_ENCRYPTION_KEY` is the usual
cause. You can hit the probe directly from inside the network at
`/_/admin/api/healthchecks/ready` on port **5601**.

**A worker exits immediately on start**
It refuses to run without `WORKER_PROJECT_ID` or `MASTER_ENCRYPTION_KEY`, and
says which one is missing in its logs. Both come from your shared `.env`.

**Routes save fine but never reach the workers**
NATS needs JetStream enabled (`-js`). The bundled compose file sets this; if you
brought your own NATS, add the flag.

**Traefik can't see the services**
Traefik reads Docker labels through the mounted Docker socket. Ensure the socket
volume is present and the services share the same network as Traefik.
