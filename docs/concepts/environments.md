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

Anything you do to try things out runs on **development** by default. Your real
callers and your live triggers reach **production** — and so do two things you
ask for on purpose: the playground's **Production** mode and a **Production**
test run, both described below.

| What | Runs on |
| :--- | :--- |
| Your public route URLs, called by your users | Production |
| Triggers, schedules and queued work of your live app | Production |
| The route playground and **Run** in the portal | Development by default; **Production** when you switch the toggle on |
| `call_route` from an AI agent | Development |
| A workflow's **Run** button | Development |
| Test suites | Development by default; **Production** runs test the promoted version (see [Test suites](/testing/#development-and-production-runs)) |
| Sandboxes and quick block runs | Development |
| Any route at `/_/dev/<path>` with the [development token](#development-access) | Development |

::: info Production is always opt-in from the portal
The playground opens on **Development** every time and does not remember a
switch to Production; it asks you to confirm the first production call. A
Production test run also asks first, and even then it uses your **development**
credentials, so it never touches production data.
:::

The route playground sends its request to the route's `/_/dev` address, with
your project's development token added for you. You never see the token. The
URL preview shows your project's address, subdomain included, and the request
goes there. The development worker picks the project from the token.

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
middlewares, triggers and packages. A route or workflow goes to each
environment where it is [switched on](#turning-a-route-or-workflow-on-or-off).
The two environments do not run the same copy: development runs your working
copy as you save it, and production runs the version you
[promoted](/concepts/versioning#what-production-serves). They also differ in the
[values](#values-per-environment) they run with, and in whether each one
[records and traces](#recording-and-tracing-per-environment) runs.
:::

::: warning
Don't put `FLUXIFY_ENV=development` in a `.env` file that every Fluxify process
reads. That turns your production worker into a development worker, and your
live routes stop being served.
:::

## Turning a route or workflow on or off

Every route and workflow has one **Enabled** switch per environment. Find them
in its settings, on the **Advanced** tab, under **Environments**.

| Switch | Environment | A new route or workflow starts… |
| :--- | :--- | :--- |
| **Development** | Development | **On**, so you can call it right away from the playground or `call_route`. |
| **Production** | Production | **Off**, so real callers get `404` until you are ready. |

Together they work like a feature flag: on in development, off in production.
Turn **Production** on when the canvas is ready. Turn it off again to stop
serving it in production while you keep working in development.

Production also needs a **promoted version**. The **Production** switch only
says that the route may be served there; what it serves is the version you
[promoted](/concepts/versioning#what-production-serves). With the switch on and
no promoted version, production answers `404`. Editing the route afterwards
changes development at once and leaves production on the promoted version, until
you promote another one or roll back.

A route that is off in an environment returns `404` there. A workflow that is
off in an environment is not given to that environment's workers, so nothing
can run it there: not a trigger, not a manual run.

These switches apply right away. They are settings of the route or workflow,
not part of its canvas.

For AI agents, the same two switches are `devActive` (development) and `active`
(production) on `save_route` and `save_workflow`.

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

The token picks the project. What the address must look like depends on whether
the project has a [subdomain](/concepts/environments#development-access):

| The project | Where `/_/dev` and `/_sandbox` answer |
| :--- | :--- |
| Has no subdomain | On the bare host, such as `localhost:5602`. |
| Has a subdomain | **Only on that subdomain.** On the bare host, or on any other host, they answer `404`, even with a valid token. |

This matches production, where a project with a subdomain also answers only on
its subdomain. The playground, **Run**, test suites and `call_route` all use the
right address for you. When you call it yourself from Postman or curl, use the
Development URL shown in the project's **Development access** settings.

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
| Where to find it | Project settings, **Development access**. It also shows your development URL, ending in `/_/dev`. If your team set a separate address for the development worker, the URL starts with it. Otherwise, if the project has a subdomain, the URL uses it, and that is the only address that works. |
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
