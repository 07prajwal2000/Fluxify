---
title: Environments
description: What production and development workers are, what runs on each, how to call a route on development at /_/dev, and how recording and tracing are set per environment.
---

# Environments

Fluxify has two fixed environments: **production** and **development**.

Every worker belongs to exactly one of them. You pick it with the `FLUXIFY_ENV`
setting when you start the worker:

| `FLUXIFY_ENV` | The worker is a… |
| :--- | :--- |
| `production` (or not set) | **Production worker.** Serves your live routes and runs your live workflows, triggers and schedules. This is every worker you have today. |
| `development` | **Development worker.** Runs development work only. |

## What runs where

Anything you do to try things out runs on **development**. Only your real
callers and your live triggers reach **production**.

| What | Runs on |
| :--- | :--- |
| Your public route URLs, called by your users | Production |
| Triggers, schedules and queued work of your live app | Production |
| The route playground and **Run** in the portal | Development |
| `call_route` from an AI agent | Development |
| A workflow's **Run** button | Development |
| Test suites | Development |
| Sandboxes and quick block runs | Development |
| Any route at `/_/dev/<path>` with the [development token](#development-access) | Development |

The route playground sends its request to the route's `/_/dev` address, with
your project's development token added for you. You never see the token.

If no development worker is running, these development features answer
"start a worker with FLUXIFY_ENV=development". In the portal the playground
shows that message and cannot send. They never fall back to production.

## The two are kept apart

A production worker never picks up development work, and a development worker
never picks up production work. This holds for everything a worker does:
queued background work, workflow runs, schedule fires and test suite runs.

You can run a production worker and a development worker side by side, on the
same machine and against the same Fluxify instance, without them stealing work
from each other.

::: info
Your triggers are the same in both environments, with the same settings. A
development worker does not get its own copy or a renamed one.
:::

## What a development worker does

- **It serves every project.** You don't point it at a project, give it a mode
  or assign it trigger groups. `WORKER_PROJECT_ID`, `WORKER_MODE` and
  `WORKER_GROUP_ID` are ignored on it.
- **It needs no claim.** You start it yourself; the orchestrator does not.
- **It does not use a license slot.** Community allows one worker, and you can
  still run one development worker beside it. See
  [Workers per edition](/deployments/editions#workers).
- **Fluxify knows when it is running.** Admin can tell whether a development
  worker is online for a project.

## Starting one

Start a worker as usual and set `FLUXIFY_ENV=development` on that worker only.

You don't have to do this for the usual setups. Each of them starts one for you:

| Setup | Its development worker |
| :--- | :--- |
| [Kit](/deployments/kit#dev-worker) | Runs inside the container, on port `5602`. Port `8080` sends `/_/dev` and `/_sandbox` to it. |
| [Production stack](/deployments/production#dev-workers) | The `worker-dev` service. |
| [Kubernetes](/deployments/kubernetes/helm-values#dev-worker) | One pod, from the `devWorker` setting. On by default. |
| Running Fluxify from source (`bun run dev`) | A second worker on port `5602`, beside the production worker on `5600`. Set `DEV_WORKER_URL=http://localhost:5602` so the playground, `call_route` and sandboxes find it. |

::: info
Every time you save, Fluxify publishes your routes, workflows, custom blocks,
middlewares, triggers and packages to **both** environments. For now the
development worker and the production worker run the same saved version. What
differs between them is the [values](#values-per-environment) they run with,
and whether each one [records and traces](#recording-and-tracing-per-environment) runs.
:::

::: warning
Don't put `FLUXIFY_ENV=development` in a `.env` file that every Fluxify process
reads. That turns your production worker into a development worker, and your
live routes stop being served.
:::

## Values per environment

Integrations and app config can hold two values: one for production and one for
development. The development worker uses the development value, so it talks to
your development database, queues and keys, never the production ones.

For each integration and each app config entry you choose one of:

| Setting | What the development worker does |
| :--- | :--- |
| **Its own value** (the default) | Uses the development value you set. If you have not set one, the run **fails** and says which value is missing. It never falls back to production. |
| **Same as production** | Uses the production value. |

See [App Config](/concepts/app-config#production-and-development-values) and
[Integrations](/integrations/#production-and-development-values).

::: danger Same as production means development writes to production
With **Same as production** on, development runs, development triggers and the
AI agent read and write your production database, queues and consumer groups.
Use it only for things that are safe to share, such as a read-only public API.
:::

::: warning Use separate development instances
Do what you would do when coding a backend by hand: point development at its
own database, its own queues or topics and its own key-value store.

Triggers have the same consumer group names in both environments. A development
value that points at a **production** queue takes production's messages.
:::

## Calling a route on development

Every route also answers on the development worker, at its normal path with
`/_/dev` in front. Send the project's [development token](#development-access)
with it:

```bash
curl -H "x-fluxify-dev-token: fxd_..." https://your-host/_/dev/users/42
```

| What you send | What you get |
| :--- | :--- |
| The right token | The route runs on development, with development values. |
| No token, or a wrong one | `401` |
| Anything, to a production worker | `404`. Production never serves `/_/dev`. |

The route behaves exactly as it does on its public URL: the same method, the
same request checks and the same middlewares. Your blocks see the path without
`/_/dev` (`/users/42` above), and they never see the token.

The token also picks the project. A project with its own subdomain only takes
its own token on that subdomain.

## Recording and tracing per environment

[Recording](/concepts/execution-recording) and
[tracing](/concepts/telemetry-configuration) are set **separately for each
environment**, on every route and every workflow.

| Setting | Development | Production |
| :--- | :--- | :--- |
| Recording | **On** by default | Off by default |
| Tracing | Off by default | Off by default |

To change them, open the route's or workflow's **Settings**, go to
**Advanced** and pick the **Development** or **Production** tab. Each tab has a
**Recording** switch and a **Tracing (OTel)** switch. **Development** is shown
first. Press **Save changes** and the setting applies right away. It is a live
setting of the route or workflow, never part of its saved graph.

Each recorded run is marked **Dev** or **Prod** in the run list. The
**Executions** page has an environment filter (**All environments**,
**Development** or **Production**) so you can look at development runs and
production runs apart.

::: warning Recording on production
Turning production recording on shows a warning: "Recording is heavy at scale.
Prefer tracing, or open the route in a sandbox to test in isolation." Every
recorded run is stored with its full data, which adds up quickly on live
traffic.
:::

Sandboxes always record.

## Development access

Every project has one **development access token**. It lets you call the
project's development routes and sandboxes from outside Fluxify, for example
from Postman, curl or a frontend you are building.

Send it in the `x-fluxify-dev-token` header:

```bash
curl -H "x-fluxify-dev-token: fxd_..." https://your-host/...
```

| What | Detail |
| :--- | :--- |
| Where to find it | Project settings, **Development access**. It also shows your development URL, ending in `/_/dev`. If your team set a separate address for the development worker, the URL starts with it. Otherwise, if the project has a subdomain, the URL uses it. |
| Who can copy it | Creators and project admins. Viewers don't see the section. |
| Who can rotate it | Project admins only. |
| What it opens | Development routes and sandboxes of that project. Nothing else. |

**Rotating** gives you a new token and the old one stops working straight away.
Anything that still uses the old token, such as a saved Postman request or a
frontend, has to be updated.

::: info It never opens production
A production worker ignores this header. The token cannot reach your live
routes, whatever you send.
:::

## Related

- [Workers per edition](/deployments/editions#workers)
- [Development workers on a production stack](/deployments/production#dev-workers)
