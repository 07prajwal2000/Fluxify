---
title: Recipe - inspect data with DB Native in a sandbox
description: Step by step tool calls that create a private sandbox, add a DB Native block against the development database, call it and read the rows, without touching a real route.
---

# Recipe - inspect data with DB Native in a sandbox

Goal: look at rows in a database table to answer a question ("how many orders are unpaid?"), without making a route. A sandbox is your own scratch canvas. Only you can see it, and it runs on a development worker with the project's **development** values, so it reads the development database.

Needs: a database integration in the project (see [Use an integration in a canvas](/agents/recipes/use-integration-in-canvas)) and a running development worker.

## 1. Find the integration

Call `list_integrations`:

```json
{ "projectId": "<project id>" }
```

Note the database integration's `id`. To see table and column names first, call `get_integration_schema_details` with `projectId` and `integrationId`.

## 2. Create the sandbox

Call `create_sandbox`:

```json
{ "projectId": "<project id>", "name": "Unpaid orders" }
```

It answers `{ "id": "<sandbox id>" }`. The sandbox starts with an entrypoint and no response.

## 3. Read its canvas

Call `get_canvas`. A sandbox target needs its `projectId`:

```json
{ "target": { "kind": "sandbox", "id": "<sandbox id>", "projectId": "<project id>" } }
```

Note the `revision` and the entrypoint key (`entrypoint_1`).

## 4. Add a DB Native block and a response

`db_native` runs your own query. Its code is in `js`, and `dbQuery(sql, params)` returns the rows. Always pass values as params, never paste them into the SQL.

Call `edit_canvas`:

```json
{
  "target": { "kind": "sandbox", "id": "<sandbox id>", "projectId": "<project id>" },
  "revision": 0,
  "ops": [
    { "op": "add_block", "ref": "query", "type": "db_native",
      "data": {
        "blockName": "Unpaid orders",
        "connection": "<integration id>",
        "js": "const rows = await dbQuery('select status, count(*)::int as n from orders where status = $1 group by status', [getQueryParam('status') ?? 'unpaid']);\nreturn rows;"
      },
      "connect_from": { "from": "entrypoint_1" } },
    { "op": "add_block", "ref": "reply", "type": "response",
      "data": { "httpCode": "200" },
      "connect_from": { "from": "query" } }
  ]
}
```

Fix every error in `issues` before you go on.

## 5. Call it

Call `call_sandbox`. Any method and any path work; the path is what the blocks see as the request path:

```json
{
  "projectId": "<project id>",
  "sandboxId": "<sandbox id>",
  "method": "GET",
  "path": "/orders",
  "query": { "status": "unpaid" }
}
```

Fluxify adds the development token for you; you never see or send it. The answer has:

| Field | What it is |
| --- | --- |
| `status`, `headers`, `body` | What the sandbox answered. `body` is the rows. |
| `runId`, `recording` | The run's recording. Read it with `get_recording` (`kind: "sandbox"`, `targetId`: the sandbox id). |
| `error` | When it failed: the block, the message and the real cause (such as the SQL error). |
| `trace` | One line per block that ran. |

## 6. Change the query and call again

Use an `edit_code` op on `db_native_1` (field `js`) with the revision `edit_canvas` returned, then `call_sandbox` again. Every call is recorded.

## Start from a route you already have

To debug a real route instead of building a canvas from nothing, copy it into a new sandbox with `copy_blocks`. See [Debug a route in a sandbox](/agents/recipes/debug-route-in-sandbox).

## 7. Clean up

When you are done, call `delete_sandbox`:

```json
{ "projectId": "<project id>", "sandboxId": "<sandbox id>" }
```

## Common problems

| What you see | What to do |
| --- | --- |
| `start a worker with FLUXIFY_ENV=development` | No development worker is running. Ask the person to start one. |
| `integration ... has no development value` | The integration has no development config. Ask the person to add one, or switch it to "Same as production". |
| `A sandbox target needs projectId` | Add `projectId` to the `target`. |
| `Not found` on a sandbox | It is someone else's, or it was deleted. Use `list_sandboxes`: it lists only yours. |
| `error.detail` names a missing column | Check names with `get_integration_schema_details`. |
