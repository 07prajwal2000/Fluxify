---
title: Integration reference for agents
description: Groups, variants, config fields, the cfg reference for secrets, errors and JSON examples for connecting a database, KV store, AI provider or queue with save_integration.
---

# Integration reference for agents

An integration is a saved connection to a database, KV store, AI provider, queue or observability service. Blocks and triggers pick one by its id. `save_integration` creates and updates it. For background, see [Integrations](/integrations/).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_integrations` | creator | Integrations of a project: id, name, group, variant, hasDevConfig, syncDev. |
| `get_integration` | creator | One integration with its production `config`, its development `devConfig` (null while it has none) and `syncDev`. |
| `get_integration_schema` | viewer | The config fields of one `group` and `variant`, with blank defaults. Reads no project data. |
| `save_integration` | creator | Create (no `integrationId`) or update (`integrationId`). |
| `test_integration_connection` | creator | Tries the connection with the **development** credentials. Makes a real network call and changes nothing. |
| `get_integration_schema_details` | creator | What is inside a saved database: table or collection names, or full detail for the ones you name. Never returns rows. |
| `kv_get` | creator | Reads one key from a saved KV store: its value and how long until it expires. Changes nothing. |
| `delete_integration` | creator | Deletes the integration. See [Delete](#delete). |

Call `get_integration_schema` before you save. It lists the exact fields. A wrong config returns the fields to fix.

## Look inside a database

`get_integration_schema_details` reads a saved PostgreSQL, MySQL or MongoDB integration. Use it before you build a block on an existing table, instead of guessing column names.

- Without `tables`: the names only. PostgreSQL tables outside the `public` schema read as `schema.table`.
- With `tables`: for each one, its columns (type, nullable, default), primary key, foreign keys and indexes.
- MongoDB has no fixed schema. You get the indexes and the field names with types, guessed from about 20 documents. A field missing from some documents is still listed. The documents themselves are never returned.

```json
{ "projectId": "…", "integrationId": "…", "tables": ["users"] }
```

```json
{
  "tables": [{
    "table": "users",
    "columns": [
      { "name": "id", "type": "integer", "nullable": false, "default": "nextval('users_id_seq'::regclass)" },
      { "name": "email", "type": "text", "nullable": false, "default": null }
    ],
    "primaryKey": ["id"],
    "foreignKeys": [],
    "indexes": [{ "name": "users_pkey", "definition": "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)" }]
  }]
}
```

A name that does not exist fails with `Unknown table "…"`. Other groups fail with `Not supported for <group> integrations`. A database that does not answer within 10 seconds fails with a timeout.

## Read a cached key

`kv_get` reads one key from a saved Redis or Memcached integration. Use it to check what a route cached.

```json
{ "key": "users:all", "found": true, "value": "[…]", "truncated": false, "ttlSeconds": 240 }
```

- Only the first 10,000 characters come back. `truncated` is `true` when the value was longer.
- `ttlSeconds` is the time left before the key expires, or `null` when it never expires.
- Memcached cannot report expiry, so `ttlSeconds` is always `null` there, with a note saying so.
- It cannot change or delete a key. To clear a bad value, do it from a route.

## Groups and variants

| `group` | `variant` values |
| --- | --- |
| `database` | `PostgreSQL`, `MySQL`, `MongoDB` |
| `kv` | `Redis`, `Memcached` |
| `ai` | `OpenAI`, `Anthropic`, `Gemini`, `Mistral`, `OpenAI Compatible` |
| `queue` | `Kafka`, `NATS`, `SQS`, `RabbitMQ` |
| `observability` | `Open Telemetry`, `Loki` |
| `baas` | None can be saved. |

`OpenAI Compatible` is for servers that speak the OpenAI protocol, such as Ollama, LM Studio, vLLM or LiteLLM.

## Keep secrets in app config

Never write a password, key or token into `config`. Save it with [`save_app_config`](/agents/app-config) and refer to it as `"cfg:KEY_NAME"`. Fluxify swaps in the value when it connects.

Any string value in `config` can be a reference. The key must already exist in the project, or the save fails with `App config 'KEY_NAME' not found`. Create the app config entry first.

## Create an integration

Pass `projectId`, `name`, `group`, `variant` and `config`.

```json
{
  "projectId": "<project id>",
  "name": "Main database",
  "group": "database",
  "variant": "PostgreSQL",
  "config": { "source": "url", "url": "cfg:MAIN_DB_URL" }
}
```

The result is `{ "id": "<integration id>" }`.

Credentials form for the same database:

```json
{
  "source": "credentials",
  "dbType": "PostgreSQL",
  "host": "db.internal",
  "port": 5432,
  "database": "app",
  "username": "app",
  "password": "cfg:MAIN_DB_PASSWORD",
  "useSSL": false
}
```

An AI provider:

```json
{ "apiKey": "cfg:OPENAI_KEY", "model": "gpt-4o-mini" }
```

## Production and development configs

An integration has two configs under one id: `config` for production and `devConfig` for development. Same fields, same variant. The development worker uses `devConfig`, or `config` when `syncDev` is `true`.

```json
{
  "projectId": "<project id>",
  "integrationId": "<integration id>",
  "devConfig": { "source": "url", "url": "cfg:MAIN_DB_URL" }
}
```

- Point `devConfig` at separate development instances: its own database, queue or topic, and KV store. Triggers have the same consumer group names in both environments, so a development config that points at a production queue takes production's messages.
- With `syncDev: false` (the default) and no `devConfig`, a development run that uses the integration fails with `integration <name> has no development value`. It never falls back to production.
- `syncDev: true` makes development use `config`. Development runs, triggers and agents then read and write production. Ask the person before setting it.
- `devConfig: null` on an update removes it. Leaving `devConfig` out keeps it.
- `cfg:KEY` references in `devConfig` read the development value of the app config entry.

## Update an integration

Pass `integrationId` and `name`, `config` or both. Whatever you leave out keeps its value.

```json
{ "projectId": "<project id>", "integrationId": "<integration id>", "name": "Primary database" }
```

- `group` and `variant` cannot change. Create a new integration instead.
- `config` replaces the whole config. Send every field, not only the one that changes. Call `get_integration` first and edit its config. The same holds for `devConfig`.
- The new config is checked against the variant. A wrong field returns a list of field errors.

## Test the connection

Tests always use the **development** credentials: the `devConfig`, or `config` when `syncDev` is `true`, and the development app config values behind any `cfg:` reference. With no development config and `syncDev` off, the test fails with `integration <name> has no development value`. Testing production credentials is only possible by a signed-in person in the portal. There is no tool for it.

Test a saved integration:

```json
{ "projectId": "<project id>", "integrationId": "<integration id>" }
```

Or test before you save:

```json
{ "projectId": "<project id>", "group": "kv", "variant": "Redis",
  "config": { "source": "url", "url": "cfg:REDIS_URL" } }
```

The answer has `success`, and when it fails an `error`. A `warning` means it connected but something will not work, for example a MongoDB server with no replica set cannot run transactions. For `observability`, `signal` is `logs` (default), `traces` or `metrics`.

## Config by variant

`?` marks an optional field. Where a variant has two forms, pick one with `source`.

| Variant | `source: "credentials"` | `source: "url"` |
| --- | --- | --- |
| `PostgreSQL` | `dbType: "PostgreSQL"`, `username`, `password`, `host`, `port`, `database`, `useSSL?` (default `false`) | `url` |
| `MySQL` | `dbType: "MySQL"`, `username`, `password`, `host`, `port`, `database` | `url` |
| `MongoDB` | `dbType: "MongoDB"`, `username?`, `password?`, `host`, `port`, `database`, `useSSL?` | `url` |
| `Redis` | `host`, `port`, `username?`, `password?`, `database?` (an index such as `"0"`) | `url` |
| `Memcached` | `host`, `port`, `username?`, `password?` | `url` |
| `RabbitMQ` | `host`, `port?`, `username?`, `password?`, `database?` (the virtual host), `useSSL?`, `sendTimeoutMs?` | `url` (`amqp://` or `amqps://`), `sendTimeoutMs?` |

For the three databases, both forms also take `queryTimeoutMs?` (milliseconds before a query stops, the runtime uses 30000 when left out) and `maxConnections?` (a positive whole number, at most 50 for PostgreSQL and MySQL and 100 for MongoDB).

`port` can be a number or text.

Variants with one form:

| Variant | Fields |
| --- | --- |
| `OpenAI`, `Anthropic`, `Gemini`, `Mistral` | `apiKey`, `model` |
| `OpenAI Compatible` | `baseUrl`, `apiKey`, `model` |
| `Kafka` | `brokers` (comma-separated `host:port`), `clientId?`, `ssl?` (default `false`), `saslMechanism?` (`none`, `PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`, default `none`), `username?`, `password?`, `dlqTopic?`, `sendTimeoutMs?` |
| `NATS` | `servers` (comma-separated `nats://host:port`), `tls?`, `token?`, `user?`, `pass?`, `creds?`, `nkeySeed?`, `dlqSubject?`, `monitoringEndpoint?`, `account?`, `sendTimeoutMs?` |
| `SQS` | `region`, `accessKeyId?`, `secretAccessKey?`, `sessionToken?`, `endpoint?`, `sendTimeoutMs?`. Blank keys fall back to the server's AWS credentials. |
| `Open Telemetry` | `baseUrl`, `credentials` (`{ "username", "password" }` or base64 text), `headers?`, `protocol?` (`http` or `grpc`, default `http`), `tlsMode?` (`none`, `tls`, `mtls`, default `tls`), `caCert?`, `clientCert?`, `clientKey?` |
| `Loki` | `baseUrl`, `credentials?`, `headers?` |

`sendTimeoutMs` is how long the Send Message block waits for the broker. The runtime uses 30000 when it is left out.

`baseUrl` must be a URL unless it is a `cfg:` reference. With `protocol: "grpc"`, `tlsMode: "mtls"` needs `clientCert` and `clientKey`.

## Use it from a canvas

Blocks take the integration **id** in a field named `connection`. `get_block_schemas` shows which blocks have one. See [Recipe, use an integration in a canvas](/agents/recipes/use-integration-in-canvas).

Triggers take the id in `integrationId`. A queue trigger needs an integration of its own kind: `Kafka`, `NATS`, `SQS`, `Redis` or `RabbitMQ`. See [Trigger reference](/agents/trigger).

## Delete

`delete_integration` deletes the integration **and every trigger that uses it**. Those triggers stop and are removed. Blocks that use the id fail at run time. Check `list_triggers` first, and `get_system_logs` after.

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Invalid input: Invalid variant` | `variant` is not in the table for that `group`, or the group is `baas`. |
| `Invalid input: apiKey: ...` | A config field is missing or wrong. The message names the field. Call `get_integration_schema`. |
| `Fluxify API error 500` on save | Variants that have a `credentials` and a `url` form (databases, Redis, Memcached, RabbitMQ) can answer a wrong config this way instead of naming the field. Pick one `source`, send every field of that form, and compare with `get_integration_schema`. |
| `Not found: App config 'KEY' not found` | A `cfg:KEY` reference names a key that does not exist. Create it with `save_app_config`. |
| `Fluxify API error 409: Integration already exists` | Another integration in the project has this name. |
| `Fluxify API error 409: Integration name already exists` | On update: the new name is taken. |
| `Not found: Integration not found` | Wrong `integrationId`. Use `list_integrations`. |
| `success: false` with an `error`, or `Invalid input: <error>` | The test could not connect. A saved integration fails with the second form. Check host, port, credentials and network access from the server. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |
