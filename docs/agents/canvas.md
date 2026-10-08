---
title: Canvas guide for agents
description: How a canvas runs (entrypoint, blocks, response), block handles and edges, how to read block schemas, how to edit with edit_canvas, errors, and saving a block output to a variable.
---

# Canvas guide for agents

Read this first when you build or change the logic of a route, workflow or custom block. A canvas is a graph of blocks. Edit it with `get_canvas` and `edit_canvas`. Settings of the route itself are in the [Route reference](/agents/route).

## How a canvas runs

1. A run starts at the **entrypoint** block.
2. It follows the edges, one block after the other.
3. Each block's output is the next block's `input`.
4. A **response** block ends the run. Its input becomes the body. See [Response](#the-response-block).

The entrypoint outputs what the run started with: on a route the parsed request body (the same as the Get Request Body block), on a workflow the data it was started with. So the first block after it reads `input.email`, not `input.body.email`.

A new route starts with an entrypoint, a response block and an error handler. Call `get_canvas` to see them, their ids and their edges before you edit.

## Blocks, handles and edges

An edge goes from one block's **output handle** to another block. A plain block has one handle, `source`. Blocks that branch or wrap other blocks have named handles.

| Block types | Handles |
| --- | --- |
| Most blocks | `source` |
| `if`, `db_exists`, `queue_send` | `success`, `failure` (no `source`) |
| `forloop`, `foreachloop` | `source` (after the loop), `executor` (the body, once per round) |
| `db_transaction`, `retry` | `success`, `failure`, `executor` (the wrapped chain) |
| `orchestrator` | `source`, `orchestrate` |
| `switch` | `case` |
| `response`, `db_rollback`, `sticky_note` | none, they end the flow |

Rules:

- A handle holds **one** edge. Only `case` and `orchestrate` can hold several. To re-point a handle, `disconnect` it first, in the same `edit_canvas` call.
- Nothing may point at the entrypoint or the error handler.
- Leave `handle` out of an op and the block's default is used: `source`, or its only handle. A block with several handles and no `source` needs `handle` named.

`get_block_schemas` with `blockTypes` lists the handles of each block and what each one means.

## Read the block contracts

Call `get_block_schemas` with no input for the list of built-in block types. Call it again with `blockTypes` (up to 10) for each block's:

- fields and their types,
- handles,
- output, which is the next block's `input`,
- an example of valid data.

A custom block's inputs come from `get_custom_block`. Any block's `data` can also hold `blockName`, `blockDescription` and `saveAsVariable`.

Block text inputs are literal unless they start with `js:`. See [Dynamic values and `js:` expressions](/agents/expressions).

## Edit with `edit_canvas`

Call `get_canvas` first. It gives `version`, `blocks` (id, type, data) and `edges` (`from`, `to`, `handle`). Pass that `version` to `edit_canvas`. If the canvas changed since, you get `Canvas changed since you read it`: read it again and redo the edit.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 4,
  "ops": [
    { "op": "add_block", "ref": "find", "type": "db_exists",
      "data": { "connection": "<integration id>", "tableName": "users", "conditions": [] },
      "connect_from": { "from": "<entry id>" } },
    { "op": "add_block", "ref": "gone", "type": "response", "data": { "httpCode": "404" },
      "connect_from": { "from": "find", "handle": "failure" } },
    { "op": "connect", "from": "find", "to": "<ok response id>", "handle": "success" }
  ]
}
```

| Op | Fields |
| --- | --- |
| `add_block` | `ref` (your name for it), `type`, `data`, optional `position`, optional `connect_from: { from, handle? }` |
| `update_block` | `id`, `data`. Only the fields that change. They are merged into the block's data. |
| `remove_block` | `id`. Its edges go with it. The entrypoint and error handler cannot be removed. |
| `connect`, `disconnect` | `from`, `to`, optional `handle` (the handle on `from`) |

- Ops run **in order**. A later op can use a `ref` added earlier in the same call, and a `disconnect` followed by a `connect` on the same handle works.
- All or nothing: one bad op (unknown block type, missing id, a handle the block does not have, a handle already used) refuses the whole call and saves nothing. The error names the block and lists its valid handles.
- The answer has the new `version` and `refs`, which maps each of your refs to the id the block got. Use those ids in later calls.
- Leave `position` out and the server places new blocks. Pass `auto_layout: true` to lay out the whole canvas again.
- `ops: []` checks the canvas and saves nothing.

### Validation

Validation runs by default and returns `issues`: `{ severity, message, blockId }`. Pass `validate: false` only to skip them.

- An `error` on a block you wrote in this call refuses the save. Fix it and call again.
- A `warning` still saves. Read it: it catches things like a `{{ }}` template or a missing `js:`.
- Issues on blocks you did not touch are reported but never block the save.

## The response block

The body of a response is the output of the block before it. The status is its `httpCode`: a fixed code like `"404"`, or `js:` code that returns one when it depends on the flow. To reshape the body in place, set `transformEnabled: true` and `transformScript` (plain code, it gets the body as `input` and returns what to send). Recipes: [Composed flows](/agents/recipes/composed-flows).

A workflow has no caller, so its end block only finishes the run and its `httpCode` is not read.

## Errors

If a block throws, the run jumps to the **error handler** block. Wire it with an edge from the handler's `source` handle to the first block of your error flow:

```json
{ "op": "connect", "from": "<error handler id>", "to": "<first error block id>" }
```

- The first block of that chain gets the error **as text** for its `input`, like `Error: <message>`.
- End the chain with a response block, such as `httpCode` `"500"`, to answer with JSON.
- With nothing on its `source` handle, the error fails the route.
- The handler's `next` field is not what the runtime follows. Use the edge.
- `retry` and `db_transaction` can catch a failure themselves on their `failure` handle. See their contracts in `get_block_schemas`.
- `call_route` returns the real cause as `error` even when callers only see a generic message. See [Debug and fix](/agents/recipes/debug-and-fix).

## Save output to variable

Any block, built in or custom, can keep its output for later blocks. Set `saveAsVariable` in the block's `data`:

```json
{ "saveAsVariable": { "enabled": true, "name": "user" } }
```

Later blocks read it as `outputs.user`:

- in a text input: `js: return outputs.user.email`
- in a code field (JS Runner, Transformer, a response `transformScript`): `outputs.user.email`

It is stored for that request only. The next request starts empty.

| Rule | Detail |
| --- | --- |
| Name | A valid identifier: starts with a letter, `_` or `$`, then letters, digits, `_` or `$`. An enabled setting with a bad name is refused when you save. |
| Saved when | The block finishes and moves on through its `source` handle. For `retry` and `db_transaction` that is `success`. `db_exists` saves the matching row on `success` and `null` on `failure`. `queue_send` saves on either branch. |
| Read before it ran | `outputs` is undefined until some block has saved, so `outputs.user` throws on a path where the block did not run. |
| Same name twice | The later block overwrites the earlier one. |

Use it when a later block needs data that `input` no longer holds:

- the body is needed after a database block replaced `input` with a row,
- one loaded row feeds an update and the response,
- a value is used in several branches.

If the next block needs only the previous output, just read `input`. Do not save everything.

## The build loop

1. `get_block_schemas` with `blockTypes` for the blocks you will use.
2. `get_canvas` for the ids and `version`.
3. `edit_canvas` with small ops. Fix every `error` in `issues`.
4. `get_system_logs` for compile errors.
5. Activate the route if needed (`save_route` with `active: true`), then `call_route` with real input.
6. Stop when the route works and its tests pass. Do not rewrite a working canvas.

## Common problems

| What you see | What to do |
| --- | --- |
| `Canvas changed since you read it` | `get_canvas` again, redo the edit with the new `version`. |
| `... has no "x" handle. Use ...` | The error lists the handles the block has. Pick one. |
| `... handle already goes to ...` | Add a `disconnect` before the `connect`, in the same call. |
| `no block "x"` | Use an id from `get_canvas`, or a `ref` added earlier in the same call. |
| `a canvas already has its one error_handler block` | A canvas has exactly one entrypoint and one error handler. Edit the existing one. |
| A block shows its text in the response | The value is a literal. Start it with `js:`. |

## Related pages

- [Dynamic values and `js:` expressions](/agents/expressions): names code can read.
- [Composed flows](/agents/recipes/composed-flows): check then update, retry, error handler, dynamic status.
- [Validate a request](/agents/recipes/validate-request): route schemas before any block.
- [Debug and fix a route or workflow](/agents/recipes/debug-and-fix).
