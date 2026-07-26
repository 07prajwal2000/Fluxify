---
title: Production Setup (Admin + Workers)
description: Deploy Fluxify for production with a separate control plane and replicated request workers behind Traefik. Includes a ready-to-use Docker Compose stack with two load-balanced workers.
---

# Production Setup (Admin + Workers)

For production, Fluxify splits into two roles so you can scale request handling
without touching the control plane:

| Role | Image | Responsibility |
| :--- | :--- | :--- |
| **Admin** | `fluxify-admin` | Control plane — dashboard, admin API, AI gateway. Applies database updates. Run **one**. |
| **Worker** | `fluxify-worker` | Executes incoming requests to your published workflows. **Stateless — run many.** |

An edge proxy (**Traefik**) sits in front and sends admin traffic to the admin
container and everything else to the pool of workers.

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

```
                 Client / API traffic
                          │
                          ▼
                   Traefik  :80
              ┌───────────┴────────────┐
   /_/admin*  │                        │  /*  (everything else)
              ▼                        ▼
        Admin container         Worker pool  (x2, load-balanced)
     (dashboard, admin API,     (executes your workflows)
      AI gateway)                        │
              └───────────┬──────────────┘
                          ▼
        PostgreSQL   ·   Valkey   ·   NATS
```

| Path | Routed to |
| :--- | :--- |
| `/_/admin*` | Admin container |
| Everything else (`/…`) | Worker pool (round-robined) |

Workers only receive traffic once they report **ready** — Traefik health-checks
each replica and holds traffic back until its dependencies have loaded.

---

## Step 1 — Create your `.env` {#env}

Copy `docker/production/env.example` to `docker/production/.env` next to the compose file. The admin and every worker share the same `.env`:

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
```

> [!WARNING]
> Back up `MASTER_ENCRYPTION_KEY`. Losing or changing it after storing data makes
> every saved credential unreadable.

> [!NOTE]
> The compose file already sets `ENABLE_ADMIN=true` on the admin service and
> keeps the workers as pure executors — you don't need to set those yourself.

### Generate your secret keys

Use this generator to create secure values for `MASTER_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET`, then paste them into your shared `.env`:

<KeyGenerator />

---

## Step 2 — Start the stack {#start}

```bash
docker compose -f docker/production/docker-compose.yml up -d
```

This launches Traefik, one admin container, **two** worker replicas, and the
Postgres / Valkey / NATS dependencies. The admin container applies database
updates on startup; workers wait for it and begin serving once ready.

---

## Step 3 — Access

| Surface | URL |
| :--- | :--- |
| Dashboard | `http://your-domain.com/_/admin/ui` |
| Admin API | `http://your-domain.com/_/admin/api` |
| Your workflows | `http://your-domain.com/` |

---

## Scaling the workers {#scaling}

Change the replica count to match your load:

```bash
docker compose -f docker/production/docker-compose.yml up -d --scale worker=4
```

Traefik picks up the new replicas automatically — no proxy change needed. Because
workers are stateless, you can scale up and down freely.

> [!TIP]
> Scale **workers**, not the admin. Keep a single admin container so database
> updates and the seed step run exactly once.

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

**Traffic returns 404 for `/_/admin` pages**
Traefik routes by path priority. Confirm the admin service still carries its
`PathPrefix(/_/admin)` label and that the container is running.

**Workers never receive traffic**
They stay out of rotation until the readiness check passes. Check a worker's
logs — a wrong `PG_URL` or a `NATS_TOKEN` mismatch is the usual cause. You can hit
the probe directly from inside the network at
`/_/admin/api/healthchecks/ready` on port `5600`.

**Traefik can't see the services**
Traefik reads Docker labels through the mounted Docker socket. Ensure the socket
volume is present and the services share the same network as Traefik.
