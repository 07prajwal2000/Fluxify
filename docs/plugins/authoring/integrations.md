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

An `ai` variant returns an `AiAdapter` with `createModel()` and, optionally, `createAgent(systemPrompt, tools)`.

::: warning Wait for the AI contract
The AI contract is changing to return AI SDK models. A variant written against the current `unknown` model shape will need to change. Wait for the updated contract before you publish an `ai` variant.
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
