---
title: Where Your Code Runs
description: Every place you can write JavaScript in Fluxify, and which names are available in each one.
---

# Where Your Code Runs

You can write JavaScript in several places. They share one core set of names, and a few places add their own. Use this page to see what you can use where.

## The basics (every place)

- **Your code always runs as an `async` function.** Use `await` anywhere, with no setup. `await httpClient.get(...)` just works.
- **`return` sends a value on.** Without it the result is empty.
- **`input` is the previous block's output.** It is local to the code, so it never leaks into variables.
- **A name you assign without `const`, `let` or `var`** becomes a request variable that later blocks can read. See [Scripting Context](./context.md#global-variables-runtime-state).
- **Libraries are not built in.** Only `jwt` is. Install anything else (Day.js, Zod, Lodash...) in **Project Settings > npm Packages** and `import` it. See [Imports & Libraries](./imports.md).

## All the places

| Where | You write code in | Adds |
| --- | --- | --- |
| **Route** (HTTP request) | [JS Runner](../blocks/js-runner.md), [Transformer](../blocks/transformer.md), `js:` fields and conditions on any block | The [core names](#core-names) |
| **Workflow** (started by a trigger, a schedule, [Trigger Workflow](../blocks/trigger-workflow.md) or the **Run** button) | The same blocks and fields | The core names, with [different values](#routes-and-workflows) |
| **Custom block** | The same blocks, inside the block's own canvas | `params`, the settings filled in where the block is used. See [Custom Blocks](../blocks/custom-blocks.md) |
| **Middleware custom block** | The same blocks, inside the block's own canvas | The core names, but no `params`: a middleware block takes no settings. After the route, `input` starts as `{ httpCode, body }`, and `getResponseBody()` / `getResponseStatus()` return the reply. See [Middlewares](../concepts/middlewares.md) |
| **DB Native** block | Its JS field | `dbQuery(query, params?)` on PostgreSQL and MySQL, `db` and `ObjectId` on MongoDB. See [DB Native](../blocks/db-native.md) |
| **KV Raw Connection** block | Its JS field | `kv`, the raw client. See [KV Raw Connection](../blocks/kv-raw.md) |
| **Test-only custom block** (setup and teardown) | The block's canvas | `testsuite`. See [Setup and Teardown](../testing/setup-and-teardown.md) |
| **Request validation** ("Use JavaScript" on a field) | The field's code box | `input` is the field's value. Return a truthy value to pass, or `throw new ValidationError(...)`. See [Routing](../getting-started/routing.md). No `import` here. |
| **Test hooks and checks** | The **Hooks** and **Checks** tabs of a suite | `t` and `fluxify`, not the names on this page. See [Hooks](../testing/hooks.md) and [Checks](../testing/checks.md) |
| **Workflow test input script** | The suite's input tab | Works like a JS block. See [Testing Workflows](../testing/workflows.md) |

## Core names

Available in every block and `js:` field of a route, workflow and custom block. The full list with types is the [JavaScript API Reference](./javascript-api.md).

| Name | What it is |
| --- | --- |
| `input` | The previous block's output |
| `outputs` | Outputs saved with **Save output to variable**, by name. It does not exist until a block has saved one, so use `outputs?.name` if unsure |
| `trigger` | What started this run |
| `getRequestBody()`, `getQueryParam(k)`, `getRouteParam(k)`, `getHeader(k)`, `getCookie(k)` | Read the request |
| `httpRequestMethod`, `httpRequestRoute` | The method and path of the request |
| `setHeader(k, v)`, `setCookie(name, options)` | Add to the response |
| `getResponseBody()`, `getResponseStatus()` | The reply, in an [after middleware](../concepts/middlewares.md). `null` anywhere else |
| `getConfig(key)` | A value from [App Config](../concepts/app-config.md) |
| `httpClient` | Call other services |
| `logger` | `logInfo`, `logWarn`, `logError` |
| `jwt` | `sign`, `verify`, `decode` |
| `ValidationError` | An error class for request validators |

## Routes and workflows

A workflow has no HTTP request, so the request names exist but are empty:

| Name | In a route | In a workflow |
| --- | --- | --- |
| `getRequestBody()` | The request body | The payload the run was given (the same value as `input` at the start) |
| `getQueryParam`, `getRouteParam`, `getHeader`, `getCookie` | The request values, `""` when missing (`undefined` for `getQueryParam`) | Always `""` (`undefined` for `getQueryParam`) |
| `httpRequestMethod` | `"GET"`, `"POST"`... | `""` |
| `httpRequestRoute` | The request path | An internal id, not a URL |
| `setHeader`, `setCookie` | Add to the response | Do nothing, there is no response |
| `trigger` | `kind: "route"`, `source: "http"`, no `data` | `kind: "trigger"`, with the events in `trigger.data` |

A route called with the header `x-fluxify-reply: async` runs in the background and answers `202` straight away. `setHeader` and `setCookie` do nothing there either.

## `trigger`

```typescript
trigger: {
  kind: "route" | "job" | "workflow" | "cron" | "trigger";
  source: string;   // "http", "internal", "schedule", "kafka", "nats"...
  reply: "sync" | "async";
  id?: string;
  data: { data: any; meta: { id?: string; receivedAt?: string; source?: string } }[];
  meta: { batchId: string; size: number; attempt?: number; /* ... */ };
  connection?: { raw; commit(); moveToDLQ(error?); lag() };   // queue triggers only
}
```

- Use `trigger.source` to tell runs apart. A schedule is `kind: "trigger"` with `source: "schedule"`. The **Trigger Workflow** block and the **Run** button are `source: "internal"`.
- `trigger.data` is **always a list**, even for one event. `input` is the bare payload when there is exactly one event, and a list of payloads when there are more.
- `kind: "job"` is a custom block that was queued to run later. The values `"workflow"` and `"cron"` are reserved and not used yet.
- Full details, batching and the queue controls are in [Triggers](../concepts/triggers.md#what-a-workflow-receives).

## Time limits

Your code has no separate time limit. The whole run has one:

- **Routes**: the route's timeout setting (30 seconds by default). It is enforced by the experimental worker watchdog, which you turn on with `experimental.workerTimeouts.enabled`.
- **Workflows**: the workflow's own timeout setting (300 seconds by default).

Keep waits short and give outgoing calls their own timeout. See [Execution Limits & Safety](./key-considerations.md).
