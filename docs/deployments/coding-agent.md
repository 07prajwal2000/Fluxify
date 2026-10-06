---
title: Deploy with a Coding Agent
description: Let a coding agent such as Claude Code, Cursor or Codex deploy Fluxify for you from llms.txt, with copy-paste prompts, a checklist to check its work, and safety rules.
---

# Deploy with a Coding Agent

A coding agent (Claude Code, Cursor, Codex and others) can deploy Fluxify for
you. You give it the docs index and a prompt. It reads the deployment pages,
writes the config, starts Fluxify, and checks that it works.

The index is one file that lists every docs page:

```
https://docs.fluxify.rest/llms.txt
```

Every page is also there as plain Markdown, for example
`https://docs.fluxify.rest/deployments/production.md`, which is easier for an
agent to read than the HTML.

## How it works

1. **Decide the basics** from [What to tell the agent](#tell-the-agent).
   An agent that has to guess them will guess wrong.
2. **Copy a prompt** from below and fill in the `<...>` parts.
3. **Let it run.** It asks before anything risky (see
   [Safety rules](#safety)).
4. **Check its report** against the [checklist](#checklist).

## What to tell the agent {#tell-the-agent}

Put these in the prompt. The prompts below have a slot for each.

| Decide | Choices |
| :--- | :--- |
| **What for** | Trying Fluxify out, or production. |
| **Where** | Docker on one server, or a Kubernetes cluster. |
| **Setup** | Kit (one container, prototypes and testing only), or Admin + Workers (production). |
| **Address** | The URL people will open, e.g. `https://fluxify.example.com`. On a laptop, `http://localhost:8080`. |
| **HTTPS** | Who holds the certificate: a load balancer or proxy you already have, or Traefik. |
| **Postgres** | Use an existing one (give its address), or create one. On Kubernetes, CloudNativePG or the chart's trial pod. |
| **NATS and Valkey** | Use ones you already run, or let the setup create them. |
| **Edition** | Community, non-commercial or Enterprise. It decides how many workers run: see [Workers per edition](./editions#workers). |
| **Projects** | One worker for every project, or separate workers for some projects. Separate workers need a subdomain per project. |
| **AI features** | On or off (`ENABLE_AI`). |
| **Secrets** | Where the agent saves the keys it generates: a password manager, a file you name, a secret manager. |

## Prompts

Each prompt tells the agent what to read, what to ask, and what to report. Fill
in the `<...>` parts. Delete a line you don't need.

### Docker, Kit: prototypes and testing

::: warning Prototypes and testing only
The Kit runs everything in one container, can't scale, and its bundled
database can't be upgraded in place across major versions. Never use it for
production: use Admin + Workers.
:::

```text
Deploy Fluxify with the Kit image, for prototyping and testing only.

Read https://docs.fluxify.rest/llms.txt first, then these pages:
- https://docs.fluxify.rest/deployments/index.md
- https://docs.fluxify.rest/deployments/kit.md
- https://docs.fluxify.rest/deployments/coding-agent.md

My setup:
- Machine: <this laptop / a server I can SSH into at ...>
- Address: <http://localhost:8080>
- Database, cache and event bus: <bundled in the container / my own at ...>
- Admin email: <admin@example.com>
- Serve every project from the one worker: WORKER_PROJECT_ID=*
- Save generated secrets and the admin password to: <path or tool>

Rules:
- This is not production. If I ask for production, stop and tell me to use
  Admin + Workers instead.
- Follow the safety rules and the checklist on the coding-agent page.
- Never print a secret or password in the chat.
- Ask before you touch anything that already exists (containers, volumes,
  databases).

When done, run the checks under "How to verify" and report each result.
```

### Docker, Admin + Workers: production

```text
Deploy Fluxify for production with Admin + Workers on Docker.

Read https://docs.fluxify.rest/llms.txt first, then these pages:
- https://docs.fluxify.rest/deployments/index.md
- https://docs.fluxify.rest/deployments/production.md
- https://docs.fluxify.rest/deployments/editions.md
- https://docs.fluxify.rest/deployments/coding-agent.md

My setup:
- Server: <host, OS, how you reach it>
- Address: <https://fluxify.example.com>
- HTTPS: <my load balancer / proxy at ... holds the certificate, and forwards
  plain HTTP to this server>
- Postgres: <create it with the compose file / use mine at postgres://...>
- NATS and Valkey: <create them with the compose file / use mine at ...>
- Images: released images, version <%%RELEASE_TAG%%>, the same tag for admin,
  orchestrator and worker
- Edition: <community / non-commercial / enterprise, key in ...>
- Workers: <one worker for every project / one route and one workflow worker /
  separate workers for project ... on subdomain ...>
- AI features: <on / off>
- Admin email: <admin@example.com>
- Save generated secrets and the admin password to: <path or tool>

Rules:
- Follow the safety rules and the checklist on the coding-agent page.
- Replace every sample key and password from env.example.
- Never print a secret or password in the chat.
- Ask before you touch anything that already exists, and before you open any
  port to the internet.

When done, run the checks under "How to verify" and report each result.
```

### Kubernetes with Helm

```text
Deploy Fluxify on my Kubernetes cluster with Helm.

Read https://docs.fluxify.rest/llms.txt first, then these pages:
- https://docs.fluxify.rest/deployments/kubernetes/install.md
- https://docs.fluxify.rest/deployments/kubernetes/helm-values.md
- https://docs.fluxify.rest/deployments/kubernetes/index.md
- https://docs.fluxify.rest/deployments/editions.md
- https://docs.fluxify.rest/deployments/coding-agent.md

My setup:
- Cluster: <kubectl context name>. Use only this context.
- Namespace: <fluxify>
- What for: <trial / production>
- Address: <https://fluxify.example.com>
- HTTPS: <TLS on Traefik's web entry point / my load balancer ends TLS>
- Postgres: <CloudNativePG, 3 copies / my database at ... / the chart's trial pod>
- NATS and Valkey: <installed by the chart / mine at ...>
- Traefik, KEDA and Metrics Server: <check and install what is missing /
  ask me first>
- Edition: <community / non-commercial / enterprise>
- AI features: <on / off>
- Keep fluxify-values.yaml at: <path in my repo>. No passwords in it.
- Save the fluxify-env Secret backup to: <path outside git>

Rules:
- Follow the safety rules and the checklist on the coding-agent page.
- Run step 1 of the install page before installing anything, and tell me
  what is already there.
- Never print a secret or password in the chat.
- Ask before you create or change anything outside the namespace above.

When done, run the checks under "How to verify" and report each result.
```

## Checklist for a correct deployment {#checklist}

Tell the agent to check each point, or check them yourself after it is done.

### Settings

| Setting | Required | Notes |
| :--- | :--- | :--- |
| `SERVER_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` | Yes (Docker) | All three are the same public address: scheme, host, port if not 80 or 443, no trailing slash. On Helm, `url` sets all three. |
| `MASTER_ENCRYPTION_KEY` | Yes | `openssl rand -base64 32`. Must decode to 32 bytes. |
| `BETTER_AUTH_SECRET` | Yes | `openssl rand -base64 32`. |
| `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` | Yes | The first admin account. Password 8+ characters. Used only on an empty database. |
| `PG_URL` | Yes, except the bundled Kit | `postgres://user:password@host:5432/database`. |
| `NATS_URL`, `NATS_TOKEN` | Yes, except the bundled Kit | The token matches the NATS server's `--auth`. |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASS` | Yes, except the bundled Kit | Valkey or Redis. |
| `ORCHESTRATOR_WORKER_IMAGE` | Yes (Docker Admin + Workers) | Same version as the admin image. |
| `SYSTEM_ACCESS_KEY` | No | For scripts that call the admin API. 8+ characters. |
| `LICENSE_KEY` | No | On the admin (or Kit) only, never on workers. Unset lets you pick the edition in the portal. |
| `ENABLE_AI` | No | `true` turns on the AI assistant. |
| `HOSTNAME` | No | The address processes listen on inside the container. Leave `0.0.0.0`. It is **not** your domain. |

On Helm, the chart generates every key and password you leave empty and keeps
them in the `fluxify-env` Secret.

### Secrets

- [ ] Every sample value from `env.example` is replaced: `MASTER_ENCRYPTION_KEY`,
  `BETTER_AUTH_SECRET`, `SYSTEM_ACCESS_KEY`, `NATS_TOKEN`, the Postgres
  password, the seed password. The example files ship real-looking values that
  anyone can read.
- [ ] `NATS_TOKEN` and the Postgres password are changed in the compose file too
  (`--auth` and `POSTGRES_PASSWORD`), to the same values.
- [ ] Secrets are saved where you said, and **not** in git.
- [ ] `MASTER_ENCRYPTION_KEY` is backed up. It is **never regenerated** once
  data exists: it locks every stored credential, and a new key makes them
  unreadable for good. The admin and every worker use the same one.
- [ ] Kit, bundled mode: the `/data` volume is backed up. The Kit generates its
  keys there on first start.
- [ ] Kubernetes: the `fluxify-env` Secret is exported to a backup file
  (install step 8).

### Services

- [ ] **NATS runs with JetStream** (`-js`), version 2.14 or newer. NATS is a
  hard dependency: without it Fluxify exits at start instead of running half
  broken.
- [ ] Postgres, NATS and (Kit) `/data` are on **persistent volumes**. Losing
  the NATS volume is recoverable (admin rebuilds it); losing Postgres is not.
- [ ] Postgres has backups, for production.
- [ ] Exactly **one admin** runs. It applies database updates at start;
  nothing needs to be run by hand.

### Network

- [ ] Only the web port is open to the internet: `8080` on the Kit, Traefik's
  port on Admin + Workers.
- [ ] Postgres, NATS, Valkey, the worker health port `5601`, and Traefik's
  dashboard (`8081` in the compose file) are **not** open to the internet.
- [ ] HTTPS ends in front of Fluxify, and the public URL uses `https://`.
- [ ] `/_/admin/*` and `/.well-known/oauth-*` both reach the admin. Other
  `/.well-known/...` paths stay with the workers. The bundled Caddy, compose and
  Helm files already do this; a proxy you add in front must not drop either.
- [ ] For cloud MCP clients (claude.ai, ChatGPT): the instance is reachable from
  the internet over `https://`. On any address other than `localhost`, MCP
  sign-in only works over HTTPS.

### Workers

- [ ] Kit: `WORKER_PROJECT_ID` is set, to a project id or `*` for every
  project. Empty means no worker, and your APIs answer `502`.
- [ ] Admin + Workers: at least one `fluxify-worker…` container or pod runs.
  A fresh install starts one worker for every project on its own.
- [ ] The number of workers fits the edition: 1 on Community, 2 on
  non-commercial, no limit on Enterprise. The node pool (starts at 2) caps it
  too. See [Workers per edition](./editions#workers).
- [ ] A project with its own workers has a subdomain, the base domain is set in
  **Instance settings → Hosting**, and DNS for that subdomain points at the
  server.
- [ ] Docker: the orchestrator mounts the Docker socket, which makes it root on
  the host. Run it on a server that holds nothing more sensitive than Fluxify.

## How to verify {#verify}

The agent runs these and reports each result. `<url>` is your public address.

| Check | Command | Expected |
| :--- | :--- | :--- |
| Containers or pods are up | `docker ps` or `kubectl get pods -n <namespace>` | Every one `Up`/`healthy` or `Running` and ready, with a `fluxify-worker…` among them (Admin + Workers). |
| Admin answers | `curl -s -o /dev/null -w '%{http_code}' <url>/_/admin/api/public-settings` | `200` |
| A worker answers | `curl -s <url>/fluxify-agent-check` | `{"message":"Route not found"}`. That is the worker. A `502`, or Traefik's plain `404 page not found`, means no worker is serving. |
| MCP server answers | `curl -i -X POST <url>/_/admin/mcp` | `401` with a `WWW-Authenticate` header. |
| MCP sign-in is found | `curl <url>/.well-known/oauth-protected-resource/_/admin/mcp` | JSON whose `resource` is `<url>/_/admin/mcp`. |
| MCP sign-in details | `curl <url>/.well-known/oauth-authorization-server/_/admin/api/auth` | JSON whose `issuer` is `<url>/_/admin/api/auth`. |
| Portal loads | Open `<url>/_/admin/ui` | The sign-in page. |
| Sign-in works | Sign in with the seed email and password | The dashboard. Do this yourself, or tell the agent where it may type the password. |
| A route runs | Create a project and a `GET /hello` route that returns some JSON, then `curl <url>/hello` | Your JSON. |

The last two need a person at a browser, or an agent that can drive one. Ask the
agent to stop and hand over at that point.

## Safety rules for the agent {#safety}

- **Never print a secret** in the chat or in logs: keys, tokens, passwords,
  database URLs with a password in them. Write them straight to where you were
  told to save them.
- **Generate secrets once.** Never regenerate `MASTER_ENCRYPTION_KEY`,
  `BETTER_AUTH_SECRET` or the Kubernetes `fluxify-env` Secret on an instance
  that already has data. Reuse what is there.
- **Ask before touching anything that already exists**: containers, volumes,
  databases, namespaces, Helm releases, DNS, firewall rules, another
  kubectl context.
- **No destructive commands without a yes**: `docker compose down -v`,
  `docker volume rm`, `--remove-orphans` (it deletes the orchestrator's
  workers), `kubectl delete namespace`, `helm uninstall`, dropping a database.
- **Kit is for prototypes and testing.** Don't use it for production, even when
  it looks simpler.
- **Don't open ports** to the internet beyond the web port without asking.
- **Stop and ask** when a step fails twice, instead of trying random fixes.

## Troubleshooting common agent mistakes {#troubleshooting}

| What you see | Likely mistake | Fix |
| :--- | :--- | :--- |
| The portal loads but sign-in fails | `SERVER_URL`, `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` don't match the address in the browser (http vs https, a port, a trailing slash, an IP instead of the domain) | Set all three to the exact address, then restart the admin. On Helm, fix `url` and upgrade. |
| The agent set `HOSTNAME` to the domain | `HOSTNAME` is the listen address, not the domain | Put it back to `0.0.0.0`. |
| Fluxify exits at start, logs mention NATS | NATS is missing, not reachable, older than 2.14, has no JetStream, or the token differs | Start NATS with `-js`, check `NATS_URL`, and make `NATS_TOKEN` match `--auth`. |
| Stored credentials fail to decrypt, or workers fail every request | `MASTER_ENCRYPTION_KEY` was regenerated, or differs between admin and workers | Restore the original key from the backup. A lost key can't be recovered: the credentials have to be entered again. |
| Kit answers `502` on `/` | `WORKER_PROJECT_ID` is empty | Set it to a project id or `*` and restart. |
| `/.well-known/oauth-…` answers `{"message":"Route not found"}` | A proxy in front sends `/.well-known` to the workers | Send `/.well-known/oauth-*` to the admin, like `/_/admin`. See [Connecting AI clients](./production#mcp). |
| A claim stays pending | More workers than the edition or node pool allows, or a project claim without a subdomain | See [Workers per edition](./editions#workers) and [Which projects a worker serves](./production#projects). |
| Can't sign in with the seed user | The seed values were changed after the first start. They only apply to an empty database | Sign in with the first values, or reset the password. |
| APIs are on plain HTTP while the portal is on HTTPS (Kubernetes) | The portal was moved to Traefik's `websecure`, but worker routes use `web` | Turn TLS on for `web`, or end TLS at a load balancer. See [Install on Kubernetes](./kubernetes/install#_2-install-traefik). |
| Admin, orchestrator and worker are different versions | Compose built admin from source but pulled the worker by tag | Use released images with one tag for all three. See [Production Setup](./production#images). |
