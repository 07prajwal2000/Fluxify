---
title: Self-Hosting Fluxify
description: Overview and decision guide for self-hosting Fluxify. Choose between the all-in-one Kit image for quick trials and the scale-out Admin + Workers topology for production, with shared setup steps and secret key generation.
---

# Self-Hosting Fluxify

Fluxify is built to run on your own infrastructure. There are **two ways** to
deploy it, and this page helps you pick the right one and points you to the exact
steps for each.

> [!WARNING]
> **Alpha software.** Fluxify is in active alpha development. It is suitable for
> self-hosted trials and early production use, but internal schemas may change
> between versions — read the release notes before upgrading.

---

## The two ways to run Fluxify

| | **Kit** (all-in-one) | **Admin + Workers** (scale-out) |
| :--- | :--- | :--- |
| **Best for** | Trials, demos, single-machine hosting | Real production traffic |
| **Containers** | One app container | Separate admin + many workers |
| **Scaling** | Vertical only (bigger machine) | Horizontal — add workers on demand |
| **Edge proxy** | Built into the image | Traefik (load-balances the workers) |
| **Setup effort** | Lowest — one command | Moderate |
| **Guide** | [Quick Run with the Kit Image →](./kit) | [Production Setup →](./production) |

### Which should I choose?

- **Just trying Fluxify, running a demo, or hosting on one machine?**
  Use the **Kit**. It bundles every service into a single container and starts
  with one command. → [Quick Run guide](./kit)

- **Serving production traffic, or expecting load that one machine can't handle?**
  Use **Admin + Workers**. The control plane runs once; stateless workers scale
  horizontally behind Traefik. → [Production guide](./production)

> [!TIP]
> Start with the Kit to evaluate, then move to Admin + Workers when you need to
> scale — your `.env` and database carry straight over.

---

## How the pieces fit together

Both topologies share the same three backing services and the same URL layout —
they differ only in how the application containers are split up.

**Kit — everything in one container:**

```
Client ──▶ Kit container :8080
             ├─ Web dashboard
             ├─ Admin API
             ├─ Request worker
             └─ AI gateway
                    │
        PostgreSQL · Valkey · NATS
```

**Admin + Workers — control plane split from a worker pool:**

```
Client ──▶ Traefik :80
             ├─ /_/admin*  ─▶ Admin container (dashboard, admin API, AI gateway)
             └─ /*         ─▶ Worker pool (x N, load-balanced)
                                     │
                         PostgreSQL · Valkey · NATS
```

### Backing services (both setups)

| Service | Role |
| :--- | :--- |
| **PostgreSQL** | Stores workflows, project configuration, and user accounts. |
| **Valkey / Redis** | Caching and fast lookups. |
| **NATS** | Event bus that keeps every container's live configuration in sync. |

### URL layout (both setups)

| Path | Serves |
| :--- | :--- |
| `/_/admin/ui` | Web dashboard (visual editor) |
| `/_/admin/api` | Admin REST API |
| `/_/admin/api/openapi/ui` | API documentation |
| `/` | Your published workflows and custom endpoints |

> [!NOTE]
> **Namespace isolation.** Everything under `/_/admin` is platform management and
> the visual editor. The entire root path `/` is reserved for the endpoints you
> build in Fluxify, so your APIs never collide with the admin surface.

---

## System requirements

| Resource | Kit (trial) | Admin + Workers (production) |
| :--- | :--- | :--- |
| **CPU** | 1 core | 2+ cores (plus ~1 core per worker) |
| **RAM** | 2 GB | 4 GB+ |
| **Disk** | 5 GB | 20 GB+ SSD |
| **Docker** | Engine 20.10+ / Desktop | Engine 20.10+ |

---

## Generate your secret keys

Both setups need the same secrets in their `.env`. Generate them once here, then
follow the guide for your chosen setup:

- `MASTER_ENCRYPTION_KEY` — encrypts stored credentials.
- `BETTER_AUTH_SECRET` — signs authentication sessions.

<KeyGenerator />

> [!WARNING]
> Back up `MASTER_ENCRYPTION_KEY`. If you lose or change it after storing data,
> every saved credential becomes permanently unreadable.

---

## Next steps

Pick your path and jump straight to the steps:

- **Kit:** [create your `.env`](./kit#env) → [start the stack](./kit#start)
- **Admin + Workers:** [why Traefik](./production#why-traefik) →
  [create your `.env`](./production#env) → [start the stack](./production#start) →
  [scale the workers](./production#scaling)
