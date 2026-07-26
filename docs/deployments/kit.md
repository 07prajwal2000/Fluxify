---
title: Quick Run with the Kit Image
description: Run all of Fluxify in a single container using the fluxify-kit image — ideal for local trials, demos, and evaluation. Includes a ready-to-use Docker Compose stack.
---

# Quick Run with the Kit Image

The **Kit** image (`fluxify-kit`) bundles everything Fluxify needs into a single
container: the admin API, the request worker, the web dashboard, the AI gateway,
and a built-in proxy. One container, one port, one command — perfect for **local
trials, demos, and evaluation**.

> [!TIP]
> Running a real production instance? Use the [Production Setup](./production)
> instead — it separates the control plane from replicated workers so you can
> scale request handling independently.

---

## What you get

| Item | Value |
| :--- | :--- |
| Containers to run | 1 app container + Postgres + Valkey + NATS |
| Public port | `8080` |
| Best for | Trials, demos, single-machine self-hosting |
| Scaling | Vertical only (bigger machine) |

Traffic enters on port `8080` and is routed for you:

| URL | Goes to |
| :--- | :--- |
| `http://localhost:8080/_/admin/ui` | Web dashboard (visual editor) |
| `http://localhost:8080/_/admin/api` | Admin REST API |
| `http://localhost:8080/_/admin/api/openapi/ui` | API documentation |
| `http://localhost:8080/` | Your published workflows & custom endpoints |

---

## Step 1 — Create your `.env` {#env}

Copy `docker/kit/env.example` to `docker/kit/.env` next to the compose file:

```bash
cp docker/kit/env.example docker/kit/.env
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
BETTER_AUTH_URL=http://localhost:8080

#====================== FIRST-RUN ADMIN ======================
SEED_USER_EMAIL=admin@example.com
SEED_USER_PASSWORD=ChangeThisPassword123!
SEED_USER_NAME=Admin User
```

> [!WARNING]
> Back up `MASTER_ENCRYPTION_KEY`. If you lose or change it after storing data,
> every saved credential becomes unreadable.

> [!IMPORTANT]
> `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` create the first admin account on the
> **first run only**. Set them before you start the stack.

### Generate your secret keys

Use this generator to create secure values for `MASTER_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET`, then paste them into your `.env`:

<KeyGenerator />

---

## Step 2 — Start the stack {#start}

Use the ready-made compose file from the repository:

```bash
docker compose -f docker/kit/docker-compose.yml up -d
```

This starts four containers: the Fluxify Kit plus its Postgres, Valkey, and NATS
dependencies. Database setup runs automatically on first boot.

---

## Step 3 — Open the dashboard

Once the containers are healthy, open:

```
http://localhost:8080/_/admin/ui
```

Log in with the seed admin credentials from your `.env`.

---

## Upgrading

```bash
docker compose -f docker/kit/docker-compose.yml pull
docker compose -f docker/kit/docker-compose.yml up -d
```

Any required database updates run automatically at startup.

---

## Troubleshooting

**Container exits immediately**
Check the logs: `docker compose -f docker/kit/docker-compose.yml logs fluxify`.
The most common cause is a bad `PG_URL` or a `NATS_TOKEN` that doesn't match the
one passed to the NATS container.

**Can't log in after first run**
The seed admin is created only on the very first boot. Confirm `SEED_USER_EMAIL`
and `SEED_USER_PASSWORD` were set **before** the stack started.

**Port 8080 already in use**
Change the host side of the mapping in the compose file (for example
`"9090:8080"`) and update `BETTER_AUTH_URL` to match.
