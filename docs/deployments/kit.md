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

#====================== THE PROJECT THIS KIT SERVES ======================
# Leave empty for now — you don't have a project yet. Step 4 fills this in.
WORKER_PROJECT_ID=
INTEGRATION_TIMEOUT_POLICY_IN_SEC=450

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

## Step 4 — Create a project and switch on the request worker {#worker}

The first time you start, you'll see this in the logs:

```
[kit] WORKER_PROJECT_ID is not set — starting without the request worker.
[kit] Create a project at /_/admin/ui, then set WORKER_PROJECT_ID and restart.
```

That's expected, not an error. Everything you need to *build* with is running —
but the part that *serves* your API needs to know which project it's serving, and
on a fresh install there isn't one yet.

So:

1. **Create a project** in the dashboard.
2. **Copy its id** from the project's settings page.
3. **Put it in `docker/kit/.env`:**

   ```env
   WORKER_PROJECT_ID=<paste-the-project-id>
   ```

4. **Bring the stack up again:**

   ```bash
   docker compose -f docker/kit/docker-compose.yml up -d
   ```

The worker now starts, and `http://localhost:8080/` serves your routes.

> [!TIP]
> From here on, saving a route in the editor publishes it to the worker in place
> — no restart and no redeploy. You only ever do this step again if you switch
> the kit to a different project. See
> [Request Lifecycle](/architecture/request-lifecycle) for what happens on save.

> [!NOTE]
> One kit serves one project. To serve several, move to the
> [Production Setup](./production), which runs a worker group per project.

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

**Requests to `/` return 502 Bad Gateway**
The request worker isn't running. Almost always this means `WORKER_PROJECT_ID`
is empty — see [Step 4](#worker). Check with
`docker compose -f docker/kit/docker-compose.yml logs fluxify | grep WORKER_PROJECT_ID`.

**Routes save fine but never go live**
NATS needs JetStream enabled. The bundled compose file starts it with `-js`
already; if you swapped in your own NATS, add that flag.

**Requests to `/` return 404 Route not found**
The worker is running but hasn't been given that route. Confirm the route is
marked active and belongs to the project in `WORKER_PROJECT_ID`, then save it
again to trigger a fresh publish.
