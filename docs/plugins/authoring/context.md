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
| `ctx.signal` | Optional. Aborts when the caller disconnects, or when a workflow run times out or is stopped ([below](#ctx-signal)) |
| `ctx.sse` | Sends server-sent events to a route that is streaming ([below](#ctx-sse)) |

## Permissions

These parts of `ctx` reach the project's data, so a block must declare them in `permissions`, and a creator grants them when approving the plugin. Anything not granted fails with an error that names what is missing and says to approve a version that asks for it.

| Declare | You get | Use |
| :--- | :--- | :--- |
| `integrations: ["database"]` | `ctx.dbFactory` | `ctx.dbFactory.getDbAdapter(id)`: a database integration's adapter |
| `integrations: ["kv"]` | `ctx.kvFactory` | `ctx.kvFactory.getKvAdapter(id)`: a key-value store |
| `integrations: ["queue"]` | `ctx.queueFactory` | `await ctx.queueFactory.getProducer(id)`: a message queue producer |
| `integrations: ["acme/email"]` | `ctx.integrations.get(id)` | Any kind, built-in or one of your own groups ([below](#using-integrations-from-a-block)) |
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

## Using integrations from a block

`ctx.integrations.get(id)` opens the integration a `param.integration` param picked. It works for every group: the built-in ones, and a group your own plugin adds.

```ts
permissions: { integrations: ["kv"] },
params: {
	store: param.integration({ kind: "kv", required: true }),
},
async run({ params, ctx }) {
	const kv = await ctx.integrations.get<"kv">(params.store);
	await kv.setex("last-run", 60, new Date().toISOString());
	return { output: await kv.get("last-run") };
},
```

The type argument decides what `get` resolves to:

| Type argument | What you get |
| :--- | :--- |
| `get<"kv">` | That built-in group's adapter: `get`, `set`, `setex` and `delete` |
| `get<"database">` | A `DatabaseAdapter` |
| `get<typeof myIntegration>` | What your integration's `connect` returns, typed for you |
| `get<MyClient>` | A type of your own. It is passed through as written, so a wrong type is not caught |

`ctx.integrations.get` is the one call that covers the built-in groups and a plugin's own groups. The group factories (`ctx.dbFactory`, `ctx.kvFactory`, `ctx.queueFactory`) still work and are what a variant-only grant cannot open; prefer `get` in new blocks.

`params.store` is `undefined` while the canvas left the picker empty. `get` then fails with `no integration was selected` before it looks anything up.

### The permission

An `integration` param needs its kind in `permissions.integrations`. A kind is a group (`kv`, `acme/email`) or one variant of it (`kv/Redis`, `acme/email/smtp`):

```ts
permissions: { integrations: ["kv"] },          // every kv integration
permissions: { integrations: ["kv/Redis"] },    // only Redis
```

The build refuses a block with an `integration` param but no permission for its kind. At run time the kind of the **selected** integration is checked again, so a grant of `kv/Redis` refuses a Memcached integration even if the canvas hands one over.

### One client per request

All through one request, `get` returns the **same** client for the same integration. Two blocks opening `acme/email` share one connection, and a client is not closed between them.

For a database, the client is the request's adapter. Inside a transaction started by a DB transaction block, every later `get<"database">` in that request is the same adapter, so a block's queries join the transaction. The transaction ends with the request.

### Errors an author will see

| Error | When |
| :--- | :--- |
| `<block> was not granted kv integrations; approve a version that asks for it` | The block used a kind its approval does not cover |
| `<block>: no integration was selected` | The param is empty |
| `<block>: integration '<id>' does not exist, has no value in this environment, or belongs to another project` | The id is unknown, the environment has no config, or the row belongs to someone else |
| `<name>: plugin acme/crm is disabled` | The integration belongs to a plugin switched off in both environments |
| `<name>: plugin acme/crm is disabled in production` | The plugin is on for development but off for this environment |
| `<name>: integration <name> has no development value` | The development config is missing and *Same as production* is off |

A plugin that is switched off hides its variants from the integrations page and from the picker, but its existing integrations are kept. A route that uses one fails with the message above, and the integrations list marks the row **plugin disabled**.

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

## ctx.signal

`ctx.signal` is an `AbortSignal`. On a route, it aborts when the caller disconnects before the route answers. In a workflow, it aborts when the run passes its time limit or is [stopped by its Run ID](/blocks/trigger-workflow#stopping-a-run). It is `undefined` when nothing can cancel the run (an async reply, a test suite run), so always treat it as optional.

Databases, key-value stores, queues, AI models and the HTTP client you get from `ctx` already stop when it aborts. Pass it on to your own slow work:

```ts
const res = await fetch(url, { signal: ctx.signal });
```

The same signal is available as `ctx.vars.abortSignal`.

## ctx.sse

`ctx.sse` lets a block stream to a route that called `sse.connect(id)` ([Streaming responses](/getting-started/streaming)). The route passes the stream's **handle** along, usually into a param of your block. The block never connects by itself.

| Call | What it does |
| :--- | :--- |
| `await ctx.sse.send(handle, data, { event, eventId })` | Sends one event. Text goes as it is, anything else as JSON. `event` and `eventId` are optional. Returns `false`, without throwing, when no client is connected or the broker failed |
| `await ctx.sse.close(handle)` | Ends the stream. Safe to call twice |
| `ctx.sse.signal(handle)` | An `AbortSignal` that aborts when the client leaves, or the stream is closed or taken over |

These are the same calls JS blocks have as `sse`, and they work wherever the block runs: in the route, in a workflow, on another server. A handle that is not one throws `not an SSE connection handle`.

`ctx.sse` needs **no permission**. The handle already names the route's broker, and a block can only reach the stream whose handle it was given.

An AI block that streams its answer and stops when the user leaves:

```ts
import { streamText } from "ai";

export default block({
	name: "acme/ai/stream-answer",
	label: "Stream answer",
	permissions: { integrations: ["ai"] },
	params: {
		llm: param.integration({ kind: "ai", required: true }),
		handle: param.string({ required: true }),
		prompt: param.string({ required: true }),
	},
	async run({ params, ctx }) {
		const signal = ctx.sse.signal(params.handle);
		const ai = await ctx.integrations.get<"ai">(params.llm);
		try {
			const result = streamText({ model: ai.languageModel(), prompt: params.prompt, abortSignal: signal });
			for await (const token of result.textStream) await ctx.sse.send(params.handle, token, { event: "token" });
			await ctx.sse.send(params.handle, "", { event: "done" });
		} catch (error) {
			if (!signal.aborted) throw error;
		} finally {
			await ctx.sse.close(params.handle);
		}
	},
});
```

Pass the signal to the model, not just to your loop: a model that keeps generating for a closed tab still costs tokens. `ctx.signal` is not enough here, because it knows nothing about the stream's client. To keep the answer running across a page refresh, use `ctx.signal` instead and let the user [stop the run](/getting-started/streaming#let-the-user-stop-the-work): `ctx.sse.signal` also aborts on a takeover. Test it with [`fakeSse`](./testing#faking-ctx).

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
