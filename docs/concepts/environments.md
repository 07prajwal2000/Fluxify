---
title: Environments
description: What production and development workers are, how to start a development worker, and how the two are kept apart.
---

# Environments

Fluxify has two fixed environments: **production** and **development**.

Every worker belongs to exactly one of them. You pick it with the `FLUXIFY_ENV`
setting when you start the worker:

| `FLUXIFY_ENV` | The worker is a… |
| :--- | :--- |
| `production` (or not set) | **Production worker.** Serves your live routes and runs your live workflows, triggers and schedules. This is every worker you have today. |
| `development` | **Development worker.** Runs development work only. |

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
| [Kit](/deployments/kit#dev-worker) | Runs inside the container, on port `5602`. |
| [Production stack](/deployments/production#dev-workers) | The `worker-dev` service. |
| [Kubernetes](/deployments/kubernetes/helm-values#dev-worker) | One pod, from the `devWorker` setting. On by default. |
| Running Fluxify from source (`bun run dev`) | A second worker on port `5602`, beside the production worker on `5600`. |

::: info
Nothing is sent to the development environment yet, so a development worker
starts, reports that it is online, and has no routes to serve for now.
:::

::: warning
Don't put `FLUXIFY_ENV=development` in a `.env` file that every Fluxify process
reads. That turns your production worker into a development worker, and your
live routes stop being served.
:::

## Related

- [Workers per edition](/deployments/editions#workers)
- [Development workers on a production stack](/deployments/production#dev-workers)
