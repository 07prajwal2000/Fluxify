---
title: Integrations
description: Add a connection your blocks can use, as a variant of a built-in group or as a group of your own, with its config form, Test connection, metadata and inspect hooks.
---

# Integrations

An integration is a connection to a service: a database, a cache, a message queue, a mail server. A plugin can add one, so the project can configure that connection once and then leave the credentials off every canvas.

A plugin's integration is written in `src/integrations` as a file that default-exports `integration({...})`:

```ts
import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";

export default integration({
	name: "acme/slack/hub",
	label: "Slack hub",
	icon: "./icons/hub.svg",
	group: "email",
	variant: "smtp",
	config: {
		host: param.string({ label: "Host", required: true }),
		password: param.secret({ label: "Password", required: true }),
	},
	async connect(config, ctx) {
		return new HubClient(config.host, ctx.getConfig(config.password));
	},
});
```

Its `name` is the plugin name plus its path under `src/integrations`, like a block's type. `integration()` checks the definition when the file loads and throws an error that names the integration, so a mistake appears in `bun test` and in the build.

## Two kinds of integration

| Kind | What it does | Who uses it |
| :--- | :--- | :--- |
| **A variant of a built-in group** | Implements the same contract as the built-in variant, so built-in blocks keep working | The built-in blocks of that group, and your own blocks |
| **A group of your own** | A new kind of connection, with a contract you design | Only your plugin's blocks |

The built-in groups are `database`, `kv`, `queue`, `ai`, `observability`, `baas` and `mcp`.

A variant of a built-in group shows up under that group with a **Plugin** badge, next to PostgreSQL or Redis. For example, a variant with `group: "kv"` becomes a choice for the built-in KV blocks without changing them.

A group of your own is filed under your plugin's **scope**: a plugin `acme/slack` with `group: "email"` becomes `acme/email`. Only blocks of the same plugin can use it. The `group` you write is a plain name; the scope is added for you, and `integration()` refuses a group that already has a slash.

::: info
A plugin can use the built-in groups and its own groups. Using another plugin's group needs a dependency between plugins, which is not supported yet.
:::

## `integration({...})` field by field

| Field | Required | What it is |
| :--- | :---: | :--- |
| `name` | Yes | The integration's type: the plugin name plus its path, `scope/name/folder/integration` |
| `label` | Yes | The name shown on the integrations page |
| `description` | No | One line under the label |
| `icon` | Yes | An image inside the plugin. The build copies it into `icons/` |
| `docs` | No | Markdown for the integration's page, in the same shape as a block's Docs tab |
| `group` | Yes | A built-in group name, or a plain name of your own |
| `variant` | Yes | This integration's name inside its group. It cannot contain `/` |
| `config` | Yes | The form the user fills in ([below](#config)) |
| `tabs` | No | The order of the form's tabs; default is first use, with General first |
| [`poolKey`](#one-client-per-config) | No | What decides which configs share a client |
| [`connect`](#connect) | Yes | Builds the client from the config |
| [`test`](#test-connection-metadata-and-inspect) | No | Test connection |
| [`describe`](#test-connection-metadata-and-inspect) | No | Metadata for pickers |
| [`inspect`](#test-connection-metadata-and-inspect) | No | Answers one request, such as a table's columns |
| `inspectRequest` | No | A zod schema that checks an `inspect` request first |
| [`close`](#close) | No | Closes a client |
| `extras` | Database only | How the variant behaves in the database blocks |
| `adapter` | Database only | Builds one request's adapter on the pooled client |

The variant's name and group become its **kind**, written `group/variant` (`kv/Redis Cache`, `acme/email/smtp`). A block's permission and its `param.integration({ kind })` name that kind.

## Config

`config` uses the same `param.*` builders as a block's params, with a smaller set of types:

| Type | What the user sees |
| :--- | :--- |
| `string` | A one-line text box |
| `number` | A number box |
| `boolean` | A checkbox |
| `select` | A dropdown, with `options` |
| `json` | A JSON editor |
| `secret` | A picker of the project's App config keys ([below](#secrets)) |
| `keyValue` | Rows of a key and a value |
| `array` | A list of items |
| `hint` | A callout, with no value |

`label`, `description`, `required`, `default`, `visibleWhen`, `tab` and `order` work as they do on a block. A `hint` takes `text`, `tone`, `tab`, `order` and `visibleWhen`.

An integration's config cannot use `js`, `appconfig`, `conditions`, `schema` or `fieldMap`: a config is a stored form, not something evaluated per request. Where a block reads an App config value through `param.appconfig`, an integration uses `param.secret()`. See [Params](./params) for every option.

## Secrets

`param.secret()` stores only the **name** of an App config key, never its value. The user picks the key in the integration form, and the stored config holds `cfg:<KEY>`.

Your hooks read the value with `ctx.getConfig(key)` in `connect`, or the second argument in `test` and `inspect`:

```ts
config: { password: param.secret({ label: "Password", required: true }) },
async connect(config, ctx) {
	// config.password is the key the user picked, not the password
	const password = ctx.getConfig(config.password);
},
```

- `getConfig` reads **only** the keys your own secret fields name. Asking for any other key throws an error that names the key.
- Reading your own secret keys needs **no** `appconfig` permission. The approval covers the integration, not each key.
- An error from `getConfig` names the missing key, never a value.
- `test`, `describe` and `inspect` do not get `getConfig`. They receive the stored config and are run with the secret values already available to the connection, so `connect` is the place to read a secret.

## connect

`connect(config, ctx)` builds the client. It may be async. The config arrives with defaults filled in and `required` params checked.

`ctx` has three members:

| Member | What it is |
| :--- | :--- |
| `ctx.getConfig(key)` | The value of an App config key one of your secret fields names ([above](#secrets)) |
| `ctx.logger` | `logInfo`, `logWarn` and `logError` |
| `ctx.signal` | Aborted when the client is closed, or when the Test connection that opened it is done. Pass it to a request library to cancel work |

A **variant of a built-in group** must return that group's adapter type from `@fluxify/sdk/integrations`; leaving a method out is a type error. A **group of your own** may return anything your blocks need. Blocks get the type from `typeof yourIntegration`, so you do not write a second client type.

## one client per config

The runtime opens one client per variant and per `poolKey(config)` and shares it. A later request with an equivalent config gets the same client instead of reconnecting.

The default key is the whole config, **including the values of its secrets**. Rotating a secret's value in App config therefore makes a new key and opens a new client.

Define `poolKey` when the config holds something that must not be part of the key, or when two configs should share a client:

```ts
// the key is the App config key, not its value
poolKey: (config) => config.url,
```

::: warning Rotating a secret under a custom pool key keeps the old client
The `config` your `poolKey` sees holds the secret's **key**, not its value. If the key decides the pool key, changing the value in App config does not change the pool key, so the existing client stays in use until the config changes some other way, or the worker restarts. Rotate a secret used this way by editing the integration or restarting the worker.
:::

`close(client)` is called when a client's pool slot goes idle and when the worker shuts down. Closing a client that was never opened is not an error.

## Test connection, metadata and inspect

These three optional hooks let the project check an integration without running a route. Each one opens a fresh client with `connect`, runs the hook, and closes the client with `close`.

| Hook | Signature | Answer |
| :--- | :--- | :--- |
| `test` | `test(client, config)` | `{ success: true }`, or `{ success: false, error }`. A throw also fails with the message. Returning nothing means success |
| `describe` | `describe(client, config)` | Metadata for pickers and the AI agent |
| `inspect` | `inspect(client, request, config)` | The answer to one request |

`inspectRequest` is a zod schema; the request is checked against it before your hook sees it. A bad request fails with the field name, without opening a client.

```ts
import { z } from "zod";

inspectRequest: z.object({ table: z.string().min(1) }),
async inspect(client, { table }) {
	return client.describeTable(table);
},
```

For a database variant, `describe` answers `{ tables }` and `inspect` answers the schema detail for the requested tables:

```ts
describe: async (adapter) => ({ tables: await adapter.introspect!() }),
inspectRequest: z.object({ tables: z.array(z.string()).optional() }),
inspect: (adapter, { tables }) => describeSchema(adapter, tables),
```

::: info These hooks run on a worker
Test connection, metadata and inspect run on a worker of the integration's **own environment**: a development config goes to a development worker, a production config to a production worker. The admin never runs your plugin code. If no worker of that environment is running, the person testing sees `No development worker is running for this project.` A hook has ten seconds of its own, and the admin waits fifteen seconds by default; a worker that misses that reports `No response from a development worker in 15s`.
:::

## close

`close(client)` releases what `connect` opened: a socket, a pool, a background listener. It runs when:

- a pooled client sits idle past the pool's timeout
- the worker shuts down
- a Test connection, `describe` or `inspect` is done with its client

Use `ctx.signal` for work that should stop the moment the client closes.

## Database variants

A database variant has the same two-step shape as the built-in database connections, because transactions need it.

1. `connect(config)` opens the **pool** and returns an object with your pool as `db` and a `close()` that closes it.
2. `adapter(pool, config)` is called **once per request** and returns a `DatabaseAdapter` built on that pool.

```ts
integration({
	group: "database",
	variant: "My SQL",
	extras: { conditionEditor: "sql", dbType: "mysql" },
	async connect(config) {
		const pool = await openPool(config);
		return { db: pool, close: () => pool.end() };
	},
	adapter(pool, config) {
		return new MyAdapter(pool.db as Pool);
	},
});
```

Keep the transaction state on the adapter, not on the pool. A block inside a transaction starts it on its own request's adapter, and every later block in that request gets the same adapter, so they join the transaction. One adapter shared between requests would mix two requests' `BEGIN`s: a rollback in one could roll back the other, and a commit would commit both. The runtime calls `adapter` per request precisely to avoid that.

`extras` is required for a database variant:

| Field | What it is |
| :--- | :--- |
| `conditionEditor` | `"sql"` for hand-written SQL, or `"js"` for a JavaScript expression that returns a native filter |
| `dbType` | The driver name the runtime resolves this variant to. It must be unique among the project's variants |

The adapter must implement every method of `DatabaseAdapter` from `@fluxify/sdk/integrations`: `getAll`, `getPage`, `getSingle`, `count`, `insert`, `insertBulk`, `update`, `raw`, `delete`, `setMode`, `startTransaction`, `commitTransaction` and `rollbackTransaction`. `introspect()` is optional; a database that cannot describe itself may leave it out, and pickers then offer fewer choices.

| Adapter | Reference |
| :--- | :--- |
| PostgreSQL | [postgresAdapter.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/db/postgresAdapter.ts) |
| MySQL | [mySqlAdapter.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/db/mySqlAdapter.ts) |
| MongoDB | [mongoDbAdapter.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/db/mongoDbAdapter.ts) |

## KV variants

A `kv` variant returns a `KvAdapter` from `@fluxify/sdk/integrations` with four methods:

| Method | What it does |
| :--- | :--- |
| `get(key)` | The value, or `null` when the key is missing |
| `set(key, value)` | Writes a value |
| `setex(key, seconds, value)` | Writes a value that expires after `seconds` |
| `delete(key)` | Removes a key |

Values are **text in both directions**: a number, boolean, date or `null` is stored and read back as a string. A missing key must read as `null`, not `""`, not `"null"`.

`getConnection()` is optional and lets an `inspect` hook reach the provider's own client. Return it if you implement `inspect`.

```ts
async inspect(client, { key }) {
	const value = await client.get(key);
	return { key, found: value !== null, value };
},
```

| Adapter | Reference |
| :--- | :--- |
| Redis | [redis.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/kv/redis.ts) |
| Memcached | [memcached.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/kv/memcached.ts) |

## Queue variants

A `queue` variant returns a `QueueProducer`. It is the contract for **sending** messages, which the Send Message block uses. Consuming a queue is not part of it; queue triggers come later.

| Member | What it does |
| :--- | :--- |
| `send(messages)` | Publishes a list of `OutgoingMessage` and answers one `SendOutcome` per message, in order. A message the broker refuses is an outcome, not a throw. A throw means the broker could not be reached |
| `client()` | The provider's own connected client, for raw use |
| `close()` | Closes the producer |

An `OutgoingMessage` is `{ destination, payload, key?, headers?, options? }`. `destination` is the topic, queue URL, routing key or stream in the provider's own terms, and `options` holds provider-specific settings such as a partition or a delay. `encodePayload` and `settleEach` from `@fluxify/sdk/integrations` help with JSON payloads and per-message outcomes.

| Producer | Reference |
| :--- | :--- |
| Kafka | [kafka.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/queue/kafka.ts) |
| NATS | [nats.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/queue/nats.ts) |
| SQS | [sqs.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/queue/sqs.ts) |
| RabbitMQ | [rabbitmq.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/queue/rabbitmq.ts) |

## AI variants

An `ai` variant returns an `AiAdapter`. Fluxify owns the connection (the provider, the key from App config, the base URL, pooling and tracing). The models it hands out are the [AI SDK](https://ai-sdk.dev)'s own, so you call `generateText`, `streamText`, `generateObject`, `tool()` or an `Agent` on them yourself.

```ts
interface AiAdapter {
	languageModel(modelId?: string): LanguageModelV4; // no id: the integration's default model
	embeddingModel?(modelId?: string): EmbeddingModelV4;
}
```

| Method | What it returns |
| :--- | :--- |
| `languageModel()` | The chat model the integration is set up with |
| `languageModel("gpt-5-mini")` | Another model from the same provider and key |
| `embeddingModel("text-embedding-3-small")` | An embedding model, where the provider has them |

`ai` and `@ai-sdk/provider` are **peer dependencies**, like `@fluxify/sdk` and `zod`: the worker provides them, so your models and the worker's AI SDK are always the same version. A provider package (`@ai-sdk/openai-compatible`, `@ai-sdk/openai`, …) is an ordinary dependency.

A variant for a provider the built-ins lack wraps that provider's AI SDK package:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { param } from "@fluxify/sdk/blocks";
import { type AiAdapter, integration } from "@fluxify/sdk/integrations";

export default integration({
	name: "acme/llm/groq",
	label: "Groq",
	icon: "./icons/groq.svg",
	group: "ai",
	variant: "Groq",
	config: {
		model: param.string({ label: "Model", required: true }),
		key: param.secret({ label: "API key", required: true }),
	},
	connect(config, ctx): AiAdapter {
		const groq = createOpenAICompatible({
			name: "groq",
			baseURL: "https://api.groq.com/openai/v1",
			apiKey: ctx.getConfig(config.key),
		});
		return { languageModel: (id = config.model) => groq.languageModel(id) };
	},
});
```

### Using a model from a block

A block runs the model with the AI SDK. Here the model may call one tool, which saves a value through another integration. `stopWhen` bounds the loop:

```ts
import { block, param } from "@fluxify/sdk/blocks";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

export default block({
	name: "acme/llm/remember",
	label: "Remember",
	permissions: { integrations: ["ai", "kv"] },
	params: {
		llm: param.integration({ kind: "ai", required: true }),
		store: param.integration({ kind: "kv", required: true }),
		prompt: param.string({ label: "Prompt", required: true }),
	},
	async run({ params, ctx }) {
		const ai = await ctx.integrations.get<"ai">(params.llm);
		const kv = await ctx.integrations.get<"kv">(params.store);
		const { text } = await generateText({
			model: ai.languageModel(),
			prompt: params.prompt,
			tools: {
				remember: tool({
					description: "Save a fact for later",
					inputSchema: z.object({ key: z.string(), value: z.string() }),
					execute: async ({ key, value }) => {
						await kv.set(key, value);
						return "saved";
					},
				}),
			},
			stopWhen: stepCountIs(5),
		});
		return { output: text };
	},
});
```

Every model call shows in the route's trace as a step under your block, named `ai:<provider>/<model>`, with its finish reason and token counts. Prompts and answers are not recorded.

::: tip Long agent loops
A sync route has a request timeout. Put a block that runs many model calls in an `async` or `queued` [invocation](./blocks#invoke), so the loop is not cut short.
:::

## Observability variants

An `observability` variant returns an `ObservabilityAdapter` with `logInfo(value)`, `logWarn(value)` and `logError(value)`. A log destination that cannot connect must not fail a request; Fluxify falls back to the console.

References: [loki.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/observability/loki.ts) and [openTelemetryLogs.ts](https://github.com/Fluxify-rest/Fluxify/blob/main/packages/adapters/observability/openTelemetryLogs.ts).

## BaaS variants

A `baas` variant returns a `BaasAdapter` with `client()`, which resolves to the provider's client. Blocks that know that provider call what they need on it.

## MCP variants

An `mcp` variant returns an `McpAdapter` with `listTools()`, `callTool(name, args, signal?)` and `close()`. It describes an MCP server the AI agent can use. The built-in variant is `mcp/http`; a plugin variant is for another transport. MCP integrations are handled by the project itself, not sent to a worker.

## Scaffolding

```sh
bunx fluxify-cli integrations create mail --group email
```

This writes `src/integrations/mail.ts`, a test and a placeholder icon. The integration's type is the plugin name plus the path: `acme/slack/mail`.

| Flag | Meaning |
| :--- | :--- |
| `--group <name>` | A built-in group, or a group of your own. Left out, the file's name is the group |
| `--force` | Not used by this command |

The database template writes the `connect` and `adapter(pool, config)` split, so a new database variant starts in the shape transactions need. The other templates stub every method of their group's contract. Replace the stubs and run `bun test`.

## Using the integration from a block

A block needs the permission, a `param.integration`, and `ctx.integrations.get`:

```ts
import mail from "../integrations/mail";

permissions: { integrations: ["acme/email"] },
params: {
	mail: param.integration({ kind: "acme/email", required: true }),
},
async run({ params, ctx }) {
	const client = await ctx.integrations.get<typeof mail>(params.mail);
	return { output: await client.send(message) };
},
```

`get<typeof yourIntegration>` gives the type your `connect` returned, so the block needs no hand-written client type. `param.integration` needs its kind in `permissions.integrations`, and the build refuses a block that has one without the other. [Context](./context#using-integrations-from-a-block) covers the request-scoped client, transactions and the errors a user or an author will see.

## Variant-specific integrations

A `param.integration` can name the **variants** it accepts:

```ts
params: {
	store: param.integration({ kind: "kv", variants: ["Redis"], required: true }),
},
```

`variants` changes three things:

- The picker offers only integrations of those variants. A Memcached integration is not in the list.
- The server refuses a value of any other variant on save, on enable and on an upgrade, with a message that names the variants: `integration "cache" is Memcached; this field takes only Redis`.
- `ctx.integrations.connection(id)` types the variant's own client for you.

The names are the variants Fluxify shows in its own pickers: `Redis`, `Memcached`, `PostgreSQL`, `MySQL`, `MongoDB`, `Kafka`, `NATS`, `SQS`, `RabbitMQ`, `OpenAI`, `Anthropic`, `Gemini`, `Mistral`, `OpenAI Compatible`, `Open Telemetry`, `Loki`, `http`. A plugin variant uses the `variant` its `integration({...})` declares.

The build stops when:

| Problem | The error says |
| :--- | :--- |
| `variants` is an empty list | `variants lists at least one variant; leave it out for every variant` |
| The same name twice | `variants must be unique` |
| The kind already names a variant (`kv/Redis`) | `kind 'kv/Redis' names a variant already; write kind 'kv' to list variants` |
| A name the kind's group does not have | `'Foo' is not a variant of kv; known: Redis, Memcached` |

The permission still names the **group**, not the variant: `permissions: { integrations: ["kv"] }`.

### connection, not get

`ctx.integrations.connection(id)` is `get` with two extras: which variant the integration is, and the variant's own client.

```ts
const connection = await ctx.integrations.connection(ctx.params.store);
connection.variant; // "Redis"
connection.client;  // the kv adapter: get, set, setex, delete
connection.raw;     // the ioredis Redis client
```

| Member | What it is |
| :--- | :--- |
| `variant` | The variant's name, never an alias |
| `client` | What `get` would return: the group's adapter, or your own integration's client |
| `raw` | The variant's own client. `undefined` where it has none |

The type follows the param. With one variant, `raw` is that client and needs no check. With several, `raw` is a union, and you **narrow on `variant`** before using it:

```ts
params: {
	database: param.integration({
		kind: "database",
		variants: ["PostgreSQL", "MySQL"],
		required: true,
	}),
},
async run({ params, ctx }) {
	const connection = await ctx.integrations.connection(params.database);
	if (connection.variant === "PostgreSQL") {
		await connection.raw`SELECT 1`; // Bun's SQL
	} else {
		await connection.raw.query("SELECT 1"); // mysql2's pool
	}
},
```

Without `variants`, the type covers every built-in variant of the group plus a plugin variant whose `raw` is `unknown`, so it cannot be narrowed to one client. List the variants when you use `raw`.

For an integration your own plugin provides, `connection<typeof myIntegration>(id)` types `raw` as what its `connect` returned. `connection` has the same grants and errors as `get`.

### What raw is, per variant

| Group | Variant | `raw` |
| :--- | :--- | :--- |
| `kv` | Redis | An ioredis `Redis` |
| `kv` | Memcached | The `memcached` client |
| `database` | PostgreSQL | Bun's `SQL` |
| `database` | MySQL | A mysql2 `Pool` |
| `database` | MongoDB | A `Db` |
| `queue` | Kafka | A `Producer` |
| `queue` | NATS | A `JetStreamClient` |
| `queue` | SQS | An `SQS` client |
| `queue` | RabbitMQ | A `ConfirmChannel` |
| `ai`, `observability`, `mcp` | every variant | `undefined` |
| any group | a plugin variant | What its `connect` returned |

The types of those drivers are **optional peer dependencies**. Installing one, for example `bun add -d ioredis` or `bun add -d mysql2`, gives you its real types and completion on `raw`. Without it, `raw` is `unknown` and the file still compiles. Your plugin does not need the driver at run time: the worker opens the integration's client and hands it over.

::: warning A database's raw client is outside the transaction
For a database variant, `raw` is the **pool**, not the request's transaction. A query sent on it runs in its own transaction, does not see a transaction another block started, and is not rolled back with it. Use `client` for the request's adapter, and reach for `raw` only when you need a query the adapter does not offer.
:::

### The Redis-streams case

A trigger that reads a Redis stream needs `XREADGROUP` and `XACK`, which the KV adapter does not have. Narrowing the param to Redis is what makes them available:

```ts
permissions: { integrations: ["kv"] },
params: {
	store: param.integration({ kind: "kv", variants: ["Redis"], required: true }),
},
async start(ctx) {
	const connection = await ctx.integrations.connection(ctx.params.store);
	const redis = connection.raw; // ioredis, typed from the param
	// XREADGROUP, then ctx.emit, then XACK once the run resolved
},
```

Without `variants`, the same call could be handed a Memcached integration and would fail at run time.

### When a saved integration no longer fits

A saved value of a variant the param no longer accepts is not cleared. The field shows an error that names the variants it takes, and the trigger or block is refused on save, enable or upgrade until it points at a fitting integration.

Narrowing `variants` in a new plugin version blocks the upgrade only while one of the project's saved values is of a dropped variant. Widening the list, or adding `variants` that every saved value already fits, blocks nothing. [Upgrading](/plugins/upgrading) lists the rest of the rules.

## Limits

- A plugin can add variants to the seven built-in groups, and groups of its own.
- A block can be granted a built-in group and its own plugin's groups. Another plugin's group is refused until plugin-to-plugin dependencies exist.
- A plugin's own group is visible only in projects that installed and approved that plugin, and only while the plugin is enabled in that environment.

## A worked example

The [integrations example](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/integrations) has a KV variant on Redis, an `email` group with an `smtp` variant, and a block that sends through it:

| File | What it shows |
| :--- | :--- |
| `src/integrations/cache.ts` | A `kv` variant with a secret URL, a key prefix and a custom `poolKey` |
| `src/integrations/smtp.ts` | A group of its own, a secret password read with `getConfig`, and Test connection |
| `src/blocks/email/send.ts` | `permissions.integrations`, `param.integration`, and `get<typeof smtp>` |

## Next

- [Context](./context#using-integrations-from-a-block): using an integration in a block
- [Testing](./testing#testing-an-integration): `runIntegration` and the `runBlock` integrations fake
- [Upgrading](/plugins/upgrading): which changes to an integration block an upgrade
