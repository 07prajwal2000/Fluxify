---
title: Export and Import
description: Save a route or a workflow, with its blocks and optionally its tests, to a file, and create it again in the same or another project.
---

# Export and Import

Export saves a route or a workflow to a file. Import creates a new one from that file, in the same project or another one. Use it to move work between projects, keep a copy, or share it with a teammate.

| | Route | Workflow |
| :--- | :--- | :--- |
| File extension | `.fluxroute` | `.fluxworkflow` |
| File name | `fluxify-route-<name>-<date>.fluxroute` | `fluxify-workflow-<name>-<date>.fluxworkflow` |
| Included | Name, path, method, timeout, request and response schemas, blocks and connections, middlewares by name | Name, description, time limit, blocks and connections |
| Tests | Optional ("Include tests") | Optional ("Include tests") |
| Left out | Recording and tracing settings, secret values | Triggers, recording and tracing settings, secret values |

Older `.fluxroute` files keep working.

::: warning Triggers are not exported
An imported workflow has no triggers until you add them. Triggers written into the file by hand are ignored.
:::

::: warning Secret values are never exported
For tests that override app config, only the setting names go into the file. Their values do not.
:::

## Exporting

| To export | Where |
| :--- | :--- |
| A route | On the **Routes** page, click the download icon on the route's row. You can also open the route and click the download button next to **Settings**. |
| A workflow | On the **Workflows** page, click the download icon ("Export workflow") on the workflow's row. |

Choose whether to **Include tests** (on by default), then click **Export**. The file downloads.

## Importing

1. On the **Routes** or **Workflows** page, click **Import** and choose a file.
2. A confirmation opens. It shows the blocks on a read-only canvas beside the form. Click a block to read its settings; nothing there can be edited. You can also change the name (and, for a route, the path) the new one will take.
3. Click **Import**. Fluxify creates it and its tests, then opens it.

Nothing is created until you confirm.

The confirmation checks the project first. If the name (for a route, the method and path) is already taken, that field starts with `-copy` added, for example `Get users-copy` or `/users/active-copy`, and a warning says what already exists. Import it as a copy, or rename it. A name that is free stays as it was in the file. Only the project you import into counts; the same name in another project is not a clash.

The imported route or workflow is **on in development and off in production**. It runs in development straight away. To put it live, promote a version, like any new one.

## What happens to things that live in the project

Custom blocks (a test's setup, teardown or loader block), middlewares and integrations belong to a project. On import they are matched **by name** against the target project. Anything with no match is left out, and a list shows what, before you open it.

| In the file | In the target project | Result |
| :--- | :--- | :--- |
| A middleware named `auth` | A middleware named `auth` exists | It is attached |
| A middleware named `auth` | None with that name | It is left out, and you are told |
| A test's setup, teardown or loader block, or integration override | A matching name exists | It is kept |
| A test's setup, teardown or loader block, or integration override | No match | It is dropped, and you are told |
| The route's SSE broker | A NATS or Redis integration with that name exists | It is used |
| The route's SSE broker | None with that name | The route has no broker, and you are told |
| App config override values | | Not imported. Set them again on the test |

## When an import can't go through

| Problem | What you see |
| :--- | :--- |
| The name (or route path) is taken, even after `-copy` | The confirmation stays open and shows the clash, so you can rename and try again. Nothing is created until it succeeds |
| The file is the wrong kind | "That file isn't a Fluxify workflow export." (or "route export") |
| The file came from a newer version of Fluxify | You are asked to update Fluxify first |

## Related

- [Workflows](/concepts/workflows)
- [Middlewares](/concepts/middlewares)
- [Versioning](/concepts/versioning)
- [Writing your first test suite](/testing/first-suite)
