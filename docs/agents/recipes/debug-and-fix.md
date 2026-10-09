---
title: Recipe - debug and fix a route or workflow
description: Step by step tool calls that find why a route or workflow fails (debug error, system logs, recording) and fix it with edit_canvas.
---

# Recipe - debug and fix a route or workflow

Goal: find why a route or workflow fails and fix it in a few calls. Go step by step and stop as soon as you know the cause. Settings are in the [Route reference](/agents/route) and the [Workflow reference](/agents/workflow).

## 1. Call it and read the debug error and trace

A failing route answers its callers with a short, generic message on purpose, such as `failed to execute native db block`. `call_route` asks for the real error and a short trace too. Its callers never get either. Most of the time that is the only call you need.

Call `call_route`:

```json
{ "routeId": "<route id>", "params": { "id": "42" }, "body": { "email": "ada@example.com" } }
```

When the route fails, the answer has an `error`:

```json
{
  "status": 500,
  "contentType": "application/json",
  "body": { "error": "Error: failed to execute native db block" },
  "error": {
    "block": { "key": "db_native_1", "type": "db_native", "name": "Load user" },
    "message": "failed to execute native db block",
    "detail": "PostgresError: column \"emial\" does not exist"
  }
}
```

| Field | Meaning |
| --- | --- |
| `block` | The block that failed: `key` (its name on the canvas, such as `db_native_1`), `type` and `name`. Missing for a route not saved since this feature came in: save it again. |
| `message` | What the block said. |
| `detail` | The real cause the message hides, such as the database error. |
| `stack` | Only for an error thrown by your own code (JS Runner, Transformer, custom block code, `js:` expressions): where in that code. |

The answer also has a `trace`: one line for each block that ran, in order, with its key, type, `ok` or `ERROR`, how long it took, and its output cut short:

```json
"trace": [
  "entrypoint_1 (entrypoint) ok 0ms",
  "jsrunner_1 (jsrunner) ok 2ms → {\"id\":\"42\"}",
  "db_native_1 (db_native) ERROR 11ms: failed to execute native db block"
]
```

- Read it top to bottom. The first `ERROR` is the block to fix; the lines before it show what each block handed on.
- A long run is cut to fit, and the last line says so: `… 12 more blocks, see get_recording`. The outputs are cut too. Step 3 shows the full run.
- A route with tracing turned off has no `trace`. Blocks inside a custom block are not listed; the custom block's own line is.
- Pass `debug: false` to leave out both the `error` and the `trace`.

A status of 400 with `Body validation failed` means the request did not pass the route's schemas, and no block ran. A route with an error handler block answers with what that handler returns, so there may be no `error`; the `trace` still shows which block failed. For more, use step 3.

`call_route` runs the route for real. It can write data and call other services, so send the inputs you need and no more.

## 2. Look for compile errors

A route or workflow that did not compile never runs your latest change. Check the logs.

Call `get_system_logs`:

```json
{ "projectId": "<project id>", "resourceId": "<route or workflow id>", "level": "error" }
```

## 3. Still unclear? Record a run

A recording shows what every block received and returned. `get_recording` is always available. `list_recordings` and `get_test_runs` are advanced tools: call `load_tools` first.

```json
{ "names": ["list_recordings", "get_test_runs"] }
```

Turn recording on. Call `save_route` (for a workflow, `save_workflow` with `workflowId`):

```json
{ "routeId": "<route id>", "recordExecution": true }
```

Call it again with `call_route`. Then call `list_recordings`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "outcome": "failure" }
```

Take the newest `id` and call `get_recording`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "runId": "<run id>" }
```

Find the first span with `outcome: "failure"`. Its `error` is the cause and its `blockKey` (the key `get_canvas` shows, like `jsrunner_1`) names the block to fix. `blockId` is the same block as an id. A span with `parentSeq` ran inside another block, such as a loop or a custom block. Pass `spanSeq` to see one span's `input` and `output`; `full: true` returns all of them (a run can be 256 KB).

Recordings keep headers, bodies and secrets as they were. Turn recording off when you are done (step 5).

## 4. Fix it

Call `get_canvas`, find the block by its key, then change only what is wrong.

Call `edit_canvas`:

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 3,
  "validate": true,
  "ops": [
    { "op": "update_block", "id": "jsrunner_1", "data": { "js": "return await dbQuery('SELECT id, email FROM users WHERE id = $1', [input.id]);" } }
  ]
}
```

`update_block` merges: send only the fields that change. `validate: true` shows rule errors and warnings. For the fields of a built-in block, call `get_block_schemas` with `blockTypes`.

## 5. Run it again until it passes

Call `call_route` with the same inputs. Repeat steps 1 to 4 until there is no `error` and the status and body are right. Then turn recording off if you turned it on:

```json
{ "routeId": "<route id>", "recordExecution": false }
```

Keep the case as a [test suite](/agents/recipes/write-and-run-test-suite) so it cannot break unseen.

## Workflows

A workflow has no URL, so there is no `call_route`. Test it with a test suite instead:

1. Call `run_test_suite` with a workflow suite (see [Write and run a test suite](/agents/recipes/write-and-run-test-suite)). Each failed case has an `error`: the same `block`, `message`, `detail` and `stack` as above.
2. Every test run is recorded, with recording off. `get_test_runs` gives each case a `traceRunId`. Pass it as `runId` to `get_recording` with `kind: "workflow"` and the workflow id.
3. For a run a trigger started, turn recording on with `save_workflow` (`recordExecution: true`), let the trigger fire, then use `list_recordings` with `kind: "workflow"`.
4. Fix with `edit_canvas` (`target.kind: "workflow"`) and run the suite again.

## Common problems

| What you see | What to do |
| --- | --- |
| No `error`, and the body still shows a generic message | The route has an error handler, or it was saved before debug errors existed. Save it again, or record a run (step 3). |
| `list_recordings` is empty | Recording was off when it ran, or it did not compile. Check `get_system_logs`, then run it again. |
| `This run has no span 9` | Use a `seq` from the span list of that run. |
| `Not found` on `get_recording` | `kind` and `targetId` must be the route or workflow that made the run. |
| The fix did not change anything | Read `get_system_logs`: a compile error keeps the old version running. |
