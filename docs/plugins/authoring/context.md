---
title: Context
description: What ctx gives a plugin block (request helpers, logger, HTTP, databases, key-value stores, queues, app config, spans and pooled clients) and which parts need a permission.
---

# Context

`run` receives `ctx`, the block's view of the route it runs in:

```ts
async run({ params, ctx }) {
	ctx.vars.logger.logInfo(`posting to ${params.channel}`);
	const res = await ctx.vars.httpClient.post("https://hooks.example.com", { text: "hi" });
},
```

## What every block gets

| Field | What it is |
| :--- | :--- |
| `ctx.projectId`, `ctx.route`, `ctx.apiId` | The project, the route's path and the route's id |
| `ctx.vars` | The route's variables and request helpers, as the JS Runner block has them ([below](#ctx-vars)) |
| `ctx.vars.logger` | `logInfo`, `logWarn` and `logError` |
| `ctx.vars.httpClient` (also `ctx.httpClient`) | An HTTP client: `get`, `post`, `put`, `patch` and `delete`. Each resolves to `{ data, status, headers }` |
| `ctx.span(name, fn)` | Times `fn` as a step of the block in the route's trace ([below](#ctx-span)) |
| `ctx.pool(kind, key, options)` | A client kept between requests ([below](#ctx-pool)) |

## Permissions

These parts of `ctx` reach the project's data, so a block must declare them in `permissions`, and a creator grants them when approving the plugin. Anything not granted fails with an error that names what is missing and says to approve a version that asks for it.

| Declare | You get | Use |
| :--- | :--- | :--- |
| `integrations: ["database"]` | `ctx.dbFactory` | `ctx.dbFactory.getDbAdapter(id)`: a database integration's adapter |
| `integrations: ["kv"]` | `ctx.kvFactory` | `ctx.kvFactory.getKvAdapter(id)`: a key-value store |
| `integrations: ["queue"]` | `ctx.queueFactory` | `await ctx.queueFactory.getProducer(id)`: a message queue producer |
| `appconfig: true` | `ctx.vars.getConfig(key)` | A value from the project's app config |

The `id` is what an [`integration` param](./params#integration-and-appconfig) hands to `run`. Declare the kind once, and the param picks which integration of that kind:

```ts
permissions: { integrations: ["kv"] },
params: { store: param.integration({ kind: "kv", required: true }) },
async run({ params, ctx }) {
	const kv = ctx.kvFactory!.getKvAdapter(params.store);
	await kv.setex("last-run", 60, new Date().toISOString());
	return { output: await kv.get("last-run") };
},
```

The factories are typed as possibly missing (`ctx.kvFactory!`) because a block without the permission does not get them.

The adapters:

| Adapter | Methods |
| :--- | :--- |
| Database | `getAll`, `getSingle`, `count`, `insert`, `insertBulk`, `update`, `delete` and `raw` (a native query) |
| Key-value | `get`, `set`, `setex` (with seconds to live) and `delete`. Values are strings |
| Queue | `send(messages)`: each message is `{ destination, payload, key?, headers?, options? }`, and each is answered with `{ ok: true, result }` or `{ ok: false, error }`. `client()` gives the connector's own client |

::: warning
A permission limits what a block is given. It is not a sandbox: plugin code runs inside Fluxify, with the same reach as any code on the worker. Ask only for what the block uses.
:::

## ctx.vars

`ctx.vars` is the object a JS Runner script sees as `vars`. Besides the logger and the HTTP client it carries the request helpers:

| Member | What it returns |
| :--- | :--- |
| `httpRequestMethod`, `httpRequestRoute` | The request's method and route |
| `getQueryParam(key)`, `getRouteParam(key)` | A query or path parameter |
| `getHeader(key)`, `setHeader(key, value)` | Read a request header, or set one on the response |
| `getCookie(key)` | A cookie |
| `getRequestBody()` | The parsed request body |
| `getConfig(key)` | An app config value (needs `appconfig: true`) |

Variables that earlier blocks stored on `vars` are there too. Prefer params and `input` for the data a block needs, and leave `vars` for request details.

## ctx.span

`ctx.span(name, fn)` runs `fn` and records it as a **child step of your block** in the route's trace, so the person debugging a slow run sees where the time went. It resolves to what `fn` returned. If `fn` throws, the step is recorded as failed with the error, and the error is rethrown to you.

```ts
const res = await ctx.span("chat.postMessage", () => client.post(url, body));
```

Spans opened inside `fn` nest under it. The agent in the [example plugin](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools) opens one per tool call:

```ts
// source: examples/plugins/agent-tools/src/blocks/agent.ts
const result = await ctx.span(`tool:${tool}`, () => target.call(args));
```

## ctx.pool

`ctx.pool(kind, key, { create, destroy, idleMs })` keeps a client (a connection to a service, an SDK object) between requests, so a block does not reconnect every time. It resolves to the client:

```ts
const client = await ctx.pool("slack", params.token, {
	create: (token) => new SlackClient(token),
	destroy: (client) => client.close(),
	idleMs: 60_000,
});
```

| Option | Meaning |
| :--- | :--- |
| `kind` | A name for what the client is. Part of what identifies it |
| `key` | The configuration the client is built from (a token, a URL, an object). A different key is a different client |
| `create(key)` | Builds the client the first time, and again after it was closed or the key changed. May be async |
| `destroy(client)` | Closes it. Optional |
| `idleMs` | How long it may sit unused before it is closed. Default 7.5 minutes. `0` keeps it until the worker shuts down |

- One client is kept for each project, block, `kind` and `key`. The key is hashed, so a secret in it is not stored or logged.
- A client is never closed while a `run` that asked for it is still going, and every pooled client is closed when the worker shuts down.
- If `create` throws, nothing is cached, and the next call tries again.
- A client from the pool must not be used from a [late `executeHandle` call](./handles#calling-after-run-returned). That call holds no lease on it, so it can be closed underneath. Ask for the client again inside the late call.
