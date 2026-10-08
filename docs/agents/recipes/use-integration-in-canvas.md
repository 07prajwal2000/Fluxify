---
title: Recipe - use an integration in a canvas
description: Step by step tool calls that save a database integration with its secret in app config, test it and read from it in a route.
---

# Recipe - use an integration in a canvas

Goal: `GET /users` returns rows from a PostgreSQL table. The connection string is a secret in app config. The same steps work for any integration: only the config and the block change. Fields are in the [Integration reference](/agents/integration) and the [App config reference](/agents/app-config).

## 1. Store the secret

Ask the person for the connection string. Never put it in an integration, a block or a chat reply.

Call `save_app_config`:

```json
{
  "projectId": "<project id>",
  "keyName": "MAIN_DB_URL",
  "value": "<postgres connection string>",
  "description": "Connection string of the main database",
  "isEncrypted": true,
  "encodingType": "plaintext"
}
```

## 2. Read the config fields

Call `get_integration_schema`:

```json
{ "group": "database", "variant": "PostgreSQL" }
```

You get `config`, the fields for each form, and `defaults`, a blank config. PostgreSQL has two forms: `source: "credentials"` and `source: "url"`.

## 3. Save the integration

Refer to the secret as `cfg:` plus the key.

Call `save_integration`:

```json
{
  "projectId": "<project id>",
  "name": "Main database",
  "group": "database",
  "variant": "PostgreSQL",
  "config": { "source": "url", "url": "cfg:MAIN_DB_URL" }
}
```

It answers `{ "id": "<integration id>" }`. If the key does not exist you get `App config 'MAIN_DB_URL' not found`: do step 1 first.

## 4. Test the connection

Call `test_integration_connection`:

```json
{ "projectId": "<project id>", "integrationId": "<integration id>" }
```

Expect `success: true`. A `warning` means it connected but something will not work. If it fails, read the `error`, correct the app config value (`save_app_config` with `appConfigId` and a new `value`), and test again. There is no need to change the integration, since it reads the key when it connects.

You can also test before saving: pass `group`, `variant` and `config` in place of `integrationId`.

## 5. Create the route, inactive

Call `save_route`:

```json
{ "projectId": "<project id>", "name": "List users", "path": "/users", "method": "GET" }
```

## 6. Read the block's fields

Call `get_block_schemas`:

```json
{ "blockTypes": ["db_getall"] }
```

The contract shows every field. The database, KV and queue blocks name the integration in a field called `connection`. It takes the integration **id**.

## 7. Build the canvas

Call `get_canvas`:

```json
{ "target": { "kind": "route", "id": "<route id>" } }
```

Note the `version`, the entrypoint id, and the id of the `response` block.

A block text input is a literal unless it starts with `js:`, and `js:` code must `return` the value. See [Dynamic values and `js:` expressions](/agents/expressions) before you fill a block field.

Call `edit_canvas`:

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 0,
  "validate": true,
  "ops": [
    { "op": "add_block", "ref": "users", "type": "db_getall",
      "data": {
        "connection": "<integration id>",
        "tableName": "users",
        "conditions": [],
        "columns": ["id", "name", "email"],
        "sort": [{ "attribute": "id", "direction": "asc" }],
        "limit": 100,
        "offset": 0,
        "paging": "offset"
      },
      "connect_from": { "from": "<entry id>" } },
    { "op": "connect", "from": "users", "to": "<response id>" }
  ]
}
```

If the canvas already has an edge from the entrypoint to the response, put `{ "op": "disconnect", "from": "<entry id>", "to": "<response id>" }` first.

The response body is the output of the block before it, so the caller gets the list of rows.

To filter, add a condition. A condition whose value is `undefined` at run time is skipped, so an optional query filter needs no `if` block:

```json
"conditions": [
  { "attribute": { "kind": "column", "value": "status" }, "operator": "eq",
    "value": { "kind": "literal", "value": "js:return getQueryParam('status')" }, "chain": "and" }
]
```

## 8. Check, activate, call

Call `get_system_logs`:

```json
{ "projectId": "<project id>", "level": "error", "resourceId": "<route id>" }
```

Call `save_route`:

```json
{ "routeId": "<route id>", "active": true }
```

Call `call_route`:

```json
{ "routeId": "<route id>" }
```

Expect `status: 200` and a list of rows in `body`. Remember `call_route` runs the route for real.

## Other integrations

| Block | Integration | Notes |
| --- | --- | --- |
| `kv_operations` | `Redis`, `Memcached` | `connection`, `operation` (`get`, `set`, `delete`), `key`. |
| `queue_send` | `Kafka`, `NATS`, `SQS`, `RabbitMQ`, `Redis` | `connection`, `destination`, `payload`. Has a success and a failure branch. |
| A custom block | Any variant, for example `OpenAI` | The block takes the id through an `integration_selector` parameter and calls the provider in its code. |

Triggers use the id in `integrationId`. See [Trigger reference](/agents/trigger).

## Rotate a secret

Update the app config value only:

Call `save_app_config`:

```json
{ "projectId": "<project id>", "appConfigId": 12, "value": "<new value>" }
```

Test the integration again. Revoke the old credential after the new one works.

## Common problems

| What you see | What to do |
| --- | --- |
| `App config 'KEY' not found` | Save the app config entry before the integration. |
| `Fluxify API error 409: Integration already exists` | Another integration has that name. Use `list_integrations`, or pick a new name. |
| `success: false` on test | Host or port not reachable from the server, or wrong credentials. A database on `localhost` means the Fluxify server's own localhost. |
| The route answers 500 | Read the `error` in the `call_route` answer, then check `get_system_logs`. See [Recipe, debug and fix a route or workflow](/agents/recipes/debug-and-fix). |
| The table or column is not found | `tableName` and `columns` must match the database exactly. |
| Deleting the integration | It also deletes every trigger that uses it. |
