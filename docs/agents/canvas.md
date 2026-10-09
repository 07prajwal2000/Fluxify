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

A new route starts with an entrypoint, a response block and an error handler. Call `get_canvas` to see them, their keys and their edges before you edit.

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

## Read a big canvas in parts

`get_canvas` returns the full data of every block. On a big canvas that is a lot to read each time. Ask for less:

- `compact: true` gives each block as `key`, `type`, `note` and a one-line `summary`. Code shows as `code: 30 lines` and a `js:` input as `js: 4 lines`. Long text is cut. Edges and `version` are the same, so the `version` works with `edit_canvas`.
- `blocks: ["jsrunner_1", "response_1"]` gives the full data of just those blocks, and the edges that touch them. An unknown key is refused and the error lists the keys on the canvas.

Read compact first, then fetch the blocks you will change.

```json
{
  "version": 12,
  "blocks": [
    { "key": "entrypoint_1", "type": "entrypoint" },
    { "key": "jsrunner_1", "type": "jsrunner", "note": "Parks the hash: KV returns true", "summary": "blockName=\"Hash it\"; value=code: 24 lines" },
    { "key": "response_1", "type": "response", "summary": "httpCode=js: 1 line" }
  ],
  "edges": ["entrypoint_1 → jsrunner_1", "jsrunner_1 → response_1"]
}
```

## Leave notes

A workaround looks like pointless plumbing to the next reader: a variable that exists only because a block returns `true`, or a hash format that lives inside one script. Write down why.

- **A block note.** Set `blockDescription` in the block's `data` (`add_block` or `update_block`) on any block whose purpose is not obvious: a workaround, a contract, why a value is parked in a variable. One or two short sentences about *why*, not what the block does: `"KV Set returns true, so the id is saved here for the response"`.
- **A sticky note.** Add a `sticky_note` block for a rule the whole canvas follows, for example `"passwords: salt:hash, pbkdf2 sha256 100k"`. It never runs and has no edges.
- **Read before you change.** `get_canvas` shows each block's note as `note`, and a sticky note's text as the note of the sticky note block. A block with the default placeholder text shows no note. Read the notes before you remove or rewire a block that looks pointless.

### Keep the canvas honest

- **Do not invent rules.** One response block per happy path is fine. Do not force several end paths onto one block just to make the canvas look tidy. Never write a note that states a rule the canvas does not already follow.
- **Notes must stay true.** After an edit, re-read every `blockDescription` and sticky note against the new edges, yours and earlier ones. Fix any note the edit made false in the same `edit_canvas` call.
- **Give blocks unique names that say where they sit.** Set `blockName` so no two blocks on a canvas share one: `200 OK: cached users` and `200 OK: users from DB`, not two blocks called `200 OK: users`. Rename a block when you clone it. Saving warns when two blocks share a name; the default name is ignored.
- **Claim "no behaviour change" only after you test it.** Call the rewired branch with input that takes it, with `call_route` or a test suite. Any 200 from the other branch proves nothing.

## Block keys

Every block has a **key**: its type and a number, such as `response_1`, `db_insert_2` or `custom_send_mail_1`. You name blocks by key in `get_canvas`, `edit_canvas` and test suite hooks. You never need a block id.

- The server gives a block its key when the block is created. You cannot choose or change it.
- A key is never reused on the same canvas, even after its block is deleted. If `response_2` is removed, the next new response block is `response_3`.
- A key tells you the block type. If you write a key that does not belong to the block it names, the op is refused.

## Edit with `edit_canvas`

Call `get_canvas` first. It gives `version`, `blocks` (key, type, data) and `edges`, written as text: `entrypoint_1 → response_1`, or `if_1.success → db_insert_1` for a block with several handles (`from.handle → to`). Pass that `version` to `edit_canvas`. If the canvas changed since, you get `Canvas changed since you read it`: read it again and redo the edit.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 4,
  "ops": [
    { "op": "add_block", "ref": "find", "type": "db_exists",
      "data": { "connection": "<integration id>", "tableName": "users", "conditions": [] },
      "connect_from": { "from": "entrypoint_1" } },
    { "op": "add_block", "ref": "gone", "type": "response", "data": { "httpCode": "404" },
      "connect_from": { "from": "find", "handle": "failure" } },
    { "op": "connect", "from": "find", "to": "response_1", "handle": "success" }
  ]
}
```

| Op | Fields |
| --- | --- |
| `add_block` | `ref` (your name for it), `type`, `data`, optional `position`, optional `connect_from: { from, handle? }` |
| `update_block` | `id`, `data`. Only the fields that change. They are merged into the block's data. |
| `edit_code` | `id`, optional `field`, `old`, `new`. Replaces exact text inside one field. See [Change part of a script](#change-part-of-a-script). |
| `remove_block` | `id`. Its edges go with it. The entrypoint and error handler cannot be removed. |
| `connect`, `disconnect` | `from`, `to`, optional `handle` (the handle on `from`) |

- `from` can also carry the handle: `"from": "if_1.success"`.
- Ops run **in order**. A later op can use a `ref` added earlier in the same call, and a `disconnect` followed by a `connect` on the same handle works.
- All or nothing: one bad op (unknown block type, missing id, a handle the block does not have, a handle already used) refuses the whole call and saves nothing. The error names the block and lists its valid handles.
- The answer has the new `version`; `changes`, one line per thing done (`updated response_1 (httpCode)`, `edited jsrunner_1.value (1 change, lines 12–14)`, `connected if_1.success → db_insert_1`, `removed log_2 (+2 edges)`), so you can see each op hit the block you meant. A block you add also says what it outputs, which is the next block's `input`; and `refs`, which maps each of your refs to the key the block got. Use those keys in later calls.
- Leave `position` out and the server places new blocks. Pass `auto_layout: true` to lay out the whole canvas again.
- `ops: []` checks the canvas and saves nothing.

### Change part of a script

A script is one long string. To change a line, do not send the whole script again with `update_block`: it costs tokens every time and a slip in the escaping can break the code without an error. Use `edit_code` instead:

```json
{ "op": "edit_code", "id": "jsrunner_1", "old": "subtotal * 0.2", "new": "subtotal * 0.1" }
```

- `field` is the text field to edit. Leave it out for the block's main code field: `value` on a JS Runner, `js` on a Transformer, KV raw and DB native, `transformScript` on a response block. Name the field to edit a `js:` text input, for example `"field": "httpCode"`.
- `old` must be found **exactly once**, spaces and line breaks included. Copy it from `get_canvas`. If it is found no times or several times, the call is refused and nothing is saved. The error says how many matches there are and on which lines, or shows the closest lines. Add more of the surrounding text to `old` to make it unique.
- The answer says where the change landed: `edited jsrunner_1.value (1 change, lines 12–14)`.
- A custom block's code is the JS Runner on its own canvas, so `edit_code` works there too: `target: { "kind": "custom_block", "id": "<custom block id>" }`.

### Validation

Validation runs by default and returns `issues`: `{ severity, message, block }`, where `block` is the key of the block it is about. Pass `validate: false` only to skip them.

- An `error` on a block you wrote in this call refuses the save. Fix it and call again.
- A `warning` still saves. Read it: it catches things like a `{{ }}` template or a missing `js:`.
- Reachability warnings name a block that is not connected to the flow, a route with no path from `entrypoint` to a response, or an open `if` branch (`if_1.failure is not connected`). Fix them before testing: an unconnected route answers the default response (NO RESULT). Retry and transaction `failure`, loop bodies and workflows or custom blocks may end open, so they stay quiet.
- Issues on blocks you did not touch are reported but never block the save.

## The response block

The body of a response is the output of the block before it. The status is its `httpCode`: a fixed code like `"404"`, or `js:` code that returns one when it depends on the flow. To reshape the body in place, set `transformEnabled: true` and `transformScript` (plain code, it gets the body as `input` and returns what to send). Recipes: [Composed flows](/agents/recipes/composed-flows).

A workflow has no caller, so its end block only finishes the run and its `httpCode` is not read.

## Errors

If a block throws, the run jumps to the **error handler** block. Wire it with an edge from the handler's `source` handle to the first block of your error flow:

```json
{ "op": "connect", "from": "error_handler_1", "to": "<first error block key>" }
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
2. `get_canvas` for the keys and `version`.
3. `edit_canvas` with small ops. Fix every `error` in `issues`.
4. `get_system_logs` for compile errors. `call_route` also gives the real error and a trace of the blocks that ran.
5. Activate the route if needed (`save_route` with `active: true`), then `call_route` with real input.
6. Stop when the route works and its tests pass. Do not rewrite a working canvas.

## Common problems

| What you see | What to do |
| --- | --- |
| `Canvas changed since you read it` | `get_canvas` again, redo the edit with the new `version`. |
| `... has no "x" handle. Use ...` | The error lists the handles the block has. Pick one. |
| `... handle already goes to ...` | Add a `disconnect` before the `connect`, in the same call. |
| `no block "x"` | Use a key from `get_canvas` (the error lists similar ones), or a `ref` added earlier in the same call. |
| `x is a ... block, not a ... block` | The key does not belong to that block. Read the canvas again and use the key it shows. |
| `a canvas already has its one error_handler block` | A canvas has exactly one entrypoint and one error handler. Edit the existing one. |
| A block shows its text in the response | The value is a literal. Start it with `js:`. |

## Related pages

- [Dynamic values and `js:` expressions](/agents/expressions): names code can read.
- [Composed flows](/agents/recipes/composed-flows): check then update, retry, error handler, dynamic status.
- [Validate a request](/agents/recipes/validate-request): route schemas before any block.
- [Debug and fix a route or workflow](/agents/recipes/debug-and-fix).
