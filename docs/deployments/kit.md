---
title: Quick Run with the Kit Image
description: Run all of Fluxify in a single container using the fluxify-kit image — ideal for local trials, demos, and evaluation. Includes a batteries-included single command and a Docker Compose stack.
---

# Quick Run with the Kit Image

The **Kit** image (`fluxify-kit`) bundles everything Fluxify needs into a single
container: the admin API, the request worker, the dashboard, the AI gateway, and
a built-in proxy. It also ships its own database, cache, and event bus, so you
can start the whole thing with one command and nothing else installed.

One container, one port, one command — perfect for **local trials, demos, and
evaluation**.

> [!TIP]
> Running a real production instance? Use the [Production Setup](./production)
> instead — it separates the control plane from replicated workers so you can
> scale request handling independently.

---

## What you get

| Item | Value |
| :--- | :--- |
| Containers to run | 1 (or 4, if you supply your own database, cache, and event bus) |
| Public port | `8080` |
| Best for | Trials, demos, single-machine self-hosting |
| Scaling | Vertical only (bigger machine) |

Traffic enters on port `8080` and is routed for you:

| URL | Goes to |
| :--- | :--- |
| `http://localhost:8080/_/admin/ui` | Dashboard (visual editor) |
| `http://localhost:8080/_/admin/api` | Admin REST API |
| `http://localhost:8080/_/admin/api/openapi/ui` | API documentation |
| `http://localhost:8080/` | Your published workflows & custom endpoints |

---

## Two ways to run it

Pick one. Both use the same image.

| | **Bundled** (recommended for trials) | **Bring your own services** |
| :--- | :--- | :--- |
| Command | `docker run` | `docker compose` |
| Database, cache, event bus | Included in the container | You supply them |
| Setup | One command, no config file | Copy and edit an environment file |
| Good for | Trying Fluxify out today | Keeping data in a database you manage |

The image decides automatically: if you tell it where to find a database, cache,
or event bus, it uses yours. If you don't, it starts its own.

---

## Option A — One command {#bundled}

Nothing to install, no configuration file:

```bash
docker run -d --name fluxify \
  -p 8080:8080 \
  -v fluxify_data:/data \
  -e SEED_USER_EMAIL=admin@example.com \
  -e SEED_USER_PASSWORD=ChangeThisPassword123! \
  fluxify-kit
```

Then open `http://localhost:8080/_/admin/ui` and log in with the email and
password you just set.

> [!IMPORTANT]
> `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` are **required** and have no
> defaults. They create the first administrator account, and nothing else can
> create it for you. A brand-new instance refuses to start without them rather
> than starting up with no way to log in. The password must be at least 8
> characters.

### About that `-v fluxify_data:/data`

Everything the kit stores lives in `/data`: your projects and routes, the event
history, and the security keys it generates the first time it starts.

**Don't skip the volume.** Without it, removing the container throws all of that
away.

> [!WARNING]
> On first start the kit generates its own encryption and session keys and saves
> them in `/data`. **Back this up.** If you lose it, saved credentials — database
> passwords, integration keys — can no longer be read, even with the same
> projects restored.

### Changing the port

If `8080` is taken, map a different one on the left-hand side and tell Fluxify
its public address:

```bash
docker run -d --name fluxify \
  -p 9090:8080 \
  -v fluxify_data:/data \
  -e SERVER_URL=http://localhost:9090 \
  -e BETTER_AUTH_URL=http://localhost:9090 \
  -e TRUSTED_ORIGINS=http://localhost:9090 \
  -e SEED_USER_EMAIL=admin@example.com \
  -e SEED_USER_PASSWORD=ChangeThisPassword123! \
  fluxify-kit
```

---

## Option B — Bring your own database, cache, and event bus {#compose}

Use this when you want your data in a database you manage and back up yourself.

### Step 1 — Create your `.env`

Copy `docker/kit/env.example` to `docker/kit/.env` next to the compose file:

```bash
cp docker/kit/env.example docker/kit/.env
```

At minimum verify these values:

```env
#====================== ENVIRONMENT ======================
NODE_ENV=production
ENVIRONMENT=production

#====================== YOUR OWN SERVICES ======================
# Setting these three switches off the built-in copies.
PG_URL=postgres://postgres:postgres@postgres:5432/fluxify_alpha
REDIS_HOST=valkey
REDIS_PORT=6379
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

> [!NOTE]
> When you supply your own services you must also supply your own
> `MASTER_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. The kit only generates those
> for you in bundled mode, where it has somewhere of its own to keep them.

### Generate your secret keys

Use this generator to create secure values for `MASTER_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET`, then paste them into your `.env`:

<KeyGenerator />

### Step 2 — Start the stack

```bash
docker compose -f docker/kit/docker-compose.yml up -d
```

This starts four containers: Fluxify plus the database, cache, and event bus.
Database setup runs automatically on first boot.

### Step 3 — Open the dashboard

```
http://localhost:8080/_/admin/ui
```

Log in with the seed admin credentials from your `.env`.

---

## Turning on the request worker {#worker}

This part applies to **both** options.

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
3. **Set `WORKER_PROJECT_ID` to that id** — in `docker/kit/.env` for Option B, or
   as another `-e WORKER_PROJECT_ID=...` for Option A.
4. **Start the container again** with the new value.

Your routes are then served at `http://localhost:8080/`.

> [!TIP]
> Prefer not to do this at all? Set `WORKER_PROJECT_ID=*` from the very first
> start and the kit serves **every** project you create, picking up new ones
> immediately with no restart. The catch: two projects that define the same path
> — say both have a `/users` endpoint — collide, and only one of them answers.
> Fine while you have one project, which is the usual case for a trial.

To opt into experimental CPU-stall protection, set the project setting
`experimental.workerTimeouts.enabled` to `true`. The worker receives that change
immediately; no restart is required.

> [!TIP]
> From here on, saving a route in the editor publishes it to the worker in place
> — no restart and no redeploy. You only repeat this step if you point the kit at
> a different project. See
> [Request Lifecycle](/architecture/request-lifecycle) for what happens on save.

> [!NOTE]
> One kit serves one project (unless you use `*` above, with the caveat noted).
> To serve several properly, move to the [Production Setup](./production), which
> runs a worker group per project.

---

## Upgrading

**Option A:**

```bash
docker pull fluxify-kit
docker rm -f fluxify
# then run the same `docker run` command again — your /data volume is reused
```

**Option B:**

```bash
docker compose -f docker/kit/docker-compose.yml pull
docker compose -f docker/kit/docker-compose.yml up -d
```

Any required database updates run automatically at startup.

> [!WARNING]
> In bundled mode, a major upgrade of the built-in database cannot be applied to
> data already on disk. Upgrades that change it are announced in the release
> notes, and the safe path is to export what you need before upgrading. This is
> one of the reasons the kit isn't meant for production — see
> [Production Setup](./production).

---

## Troubleshooting

**Container exits immediately, log says an admin email or password is required**
The first administrator account can only come from `SEED_USER_EMAIL` and
`SEED_USER_PASSWORD`. Set both (password 8+ characters) and start it again.

**Container exits immediately, other causes**
Check the logs: `docker logs fluxify` (Option A) or
`docker compose -f docker/kit/docker-compose.yml logs fluxify` (Option B). In
Option B the usual cause is a bad `PG_URL`, or a `NATS_TOKEN` that doesn't match
the one given to the event bus container.

**The container stops when one part of it fails**
That's deliberate. If any internal service dies, the whole container exits so
your restart policy brings it back, instead of leaving it running and quietly
broken. The log line naming the failed service is the last one printed.

**Can't log in after first run**
The seed admin is created only on the very first boot, against an empty
database. If you changed the values afterwards, they had no effect — reset the
password from the dashboard, or start over with a fresh volume.

**Everything was working, then a restart lost all my projects**
You most likely ran without `-v fluxify_data:/data`. Data lives in that volume;
without it, removing the container discards everything.

**Port 8080 already in use**
Map a different host port and update `SERVER_URL`, `BETTER_AUTH_URL`, and
`TRUSTED_ORIGINS` to match. See [Changing the port](#bundled).

**Requests to `/` return 502 Bad Gateway**
The request worker isn't running. Almost always this means `WORKER_PROJECT_ID`
is empty — see [Turning on the request worker](#worker). Confirm with
`docker logs fluxify | grep WORKER_PROJECT_ID`.

**Requests to `/` return 404 Route not found**
The worker is running but doesn't have that route. Confirm the route is marked
active and belongs to the project in `WORKER_PROJECT_ID`, then save it again to
publish it.

**Routes save fine but never go live**
The event bus needs JetStream enabled. The bundled copy and the supplied compose
file both do this already; if you swapped in your own, start it with `-js`.
