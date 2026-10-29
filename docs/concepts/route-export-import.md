---
title: Route Export and Import
description: Save a route, with its blocks and optionally its tests, to a file, and create it again in the same or another project.
---

# Route Export and Import

Export saves a route to a `.fluxroute` file. Import creates a new route from that file, in the same project or another one. Use it to move a route between projects, keep a copy, or share one with a teammate.

## Exporting a route

1. On the **Routes** page, click the download icon on the route's row. You can also open the route and click the download button next to **Settings**.
2. Choose whether to **Include tests**. It is on by default.
3. Click **Export**. The file downloads.

## What the file contains

| Included | Notes |
| :--- | :--- |
| Name, path, method, timeout | The route's settings |
| Request and response schemas | The body, query and params schemas, and the schema for each status code |
| Blocks and connections | The whole canvas, with positions |
| Middlewares | By name, in the order they run |
| Tests (optional) | Each suite's request, checks, block hooks, and setup and teardown blocks |

::: warning Secret values are never exported
For tests that override app config, only the setting names go into the file. Their values do not.
:::

## Importing a route

1. On the **Routes** page, click **Import** and choose a `.fluxroute` file.
2. A confirmation opens. It shows the route's blocks on a read-only canvas, beside the form. Click a block to read its settings; nothing there can be edited. That way you can see what is inside before anything is created, and the name and path the new route will take. You can change both.
3. Click **Import**. Fluxify creates the route and its tests, then opens the route.

Nothing is created until you confirm.

The confirmation checks the project before it opens. If the route's name or path is already taken in this project, that field starts with `-copy` added, for example `Get users-copy` or `/users/active-copy`, and a warning under the fields says what already exists. Import it as a copy, or rename it as you like. A name or path that is free stays as it was in the file.

Only routes in the project you are importing into count. The same path in another project is not a clash.

The imported route is **off in production**. It answers in development straight away. To serve it in production, turn it on and promote a version, like any new route.

## What happens to things that live in the project

Middlewares, custom blocks and integrations belong to a project, not to a route. On import they are matched **by name** against the target project.

| In the file | In the target project | Result |
| :--- | :--- | :--- |
| A middleware named `auth` | A middleware named `auth` exists | It is attached |
| A middleware named `auth` | None with that name | It is left out, and you are told |
| A test's setup block or integration override | A matching name exists | It is kept |
| A test's setup block or integration override | No match | It is dropped, and you are told |
| App config override values | | Not imported. Set them again on the test |

If anything was left out, a list shows what, before you open the route.

## When an import can't go through

| Problem | What you see |
| :--- | :--- |
| The name or path is taken, even after `-copy` | The confirmation stays open and shows the clash, so you can change the name or path and try again. Nothing is created until it succeeds |
| The file is not a route export | "That isn't a Fluxify route export." |
| The file came from a newer version of Fluxify | You are asked to update Fluxify first |

## Related

- [Middlewares](/concepts/middlewares)
- [Versioning](/concepts/versioning)
- [Writing your first test suite](/testing/first-suite)
