---
title: Recipe - debug a failing route with a recording
description: Step by step tool calls that turn on recording, reproduce a failure, find the block that failed and read its input and output.
---

# Recipe - debug a failing route with a recording

Goal: find which block of a route fails and why, using a recorded run. Settings are in the [Route reference](/agents/route). Block errors also show in `get_system_logs`, but only a recording shows what each block received and returned.

Recordings keep request headers, bodies and secrets exactly as they were. Turn recording off when you are done.

## 1. Look at the route

Call `get_route`:

```json
{ "routeId": "<route id>" }
```

Check `active` (an inactive route answers 404), the schemas, and `recordExecution`.

Look for compile errors first. A route that did not compile has no runs to record:

Call `get_system_logs`:

```json
{ "projectId": "<project id>", "resourceId": "<route id>", "level": "error" }
```

## 2. Turn recording on

Call `save_route`:

```json
{ "routeId": "<route id>", "recordExecution": true }
```

Only runs after this are kept. Earlier runs were never saved.

## 3. Reproduce the failure

`call_route` sends a real request. It can write data and call other services, so use the same inputs the failing caller used and no more.

Call `call_route`:

```json
{ "routeId": "<route id>", "params": { "id": "42" }, "query": { "expand": "roles" }, "body": { "email": "ada@example.com" } }
```

The answer has `status`, `contentType` and `body`. A body over 10000 characters is cut. A status of 400 with `Body validation failed` means the request did not pass the route's schemas, and no block ran.

If a real caller made the failing request, skip this step and read their run in step 4.

## 4. List the failed runs

Call `list_recordings`:

```json
{
  "projectId": "<project id>",
  "kind": "route",
  "targetId": "<route id>",
  "outcome": "failure",
  "source": "live"
}
```

Each item has `id`, `startedAt`, `durationMs`, `outcome`, `statusCode`, `spanCount` and `truncated`. Use `source: "test"` for runs made by test suites. Narrow with `from` and `to` (ISO times). Newest first. Take the `id` of the run you want.

## 5. Read the run

Call `get_recording`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "runId": "<run id>" }
```

You get the run and its `spans`, one for each block that ran, in order. Each span has `seq`, `parentSeq`, `blockId`, `blockType`, `blockName`, `outcome`, `branch`, `error`, `truncated` and `metadata`. Inputs and outputs are left out to keep the answer small.

Find the first span with `outcome: "failure"`. Its `error` is the cause. Its `blockId` is the block to fix. A span with `parentSeq` ran inside another block, such as a loop or a custom block.

`childRuns` lists runs that an async custom block started on its own. Read them with the same call.

## 6. Read one block in full

Call `get_recording`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "runId": "<run id>", "spanSeq": 4 }
```

This returns that span with its `input` and `output`. Compare `input` with what the block expects. The span before it shows where the input came from.

`full: true` returns every span with input and output. A run can be 256 KB, so prefer `spanSeq`.

## 7. Fix the block

Call `get_canvas`:

```json
{ "target": { "kind": "route", "id": "<route id>" } }
```

Find the block by `blockId`. Then change only what is wrong:

Call `edit_canvas`:

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 3,
  "validate": true,
  "ops": [
    { "op": "update_block", "id": "<block id>", "data": { "value": "return { id: Number(input.id) };" } }
  ]
}
```

`update_block` merges: send only the fields that change. For the fields of a built-in block, call `get_block_schemas` with `blockTypes`.

## 8. Run it again and confirm

Call `call_route`:

```json
{ "routeId": "<route id>", "params": { "id": "42" } }
```

Call `list_recordings`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "outcome": "success" }
```

The new run should be the newest `success`. Read it with `get_recording` if you want to see each block's output.

## 9. Turn recording off

Call `save_route`:

```json
{ "routeId": "<route id>", "recordExecution": false }
```

Keep a failing case as a [test suite](/agents/recipes/write-and-run-test-suite) so it cannot return unseen.

## Limits and good to know

- A run keeps at most 1000 spans and 256 KB. Anything past that is dropped and `truncated` is `true`. A single input or output is cut at 8 KB.
- Recordings are deleted after 30 days. The operator can change that.
- Every **test suite** run is recorded, with recording off. `get_test_runs` gives each case a `traceRunId`. Pass it as `runId` to `get_recording`.
- A block that a test hook skipped or changed shows `mocked` in its span `metadata`.
- Recording needs the Creator role. A viewer sees nothing.
- A workflow works the same way. Use `kind: "workflow"` and `save_workflow`.

## Common problems

| What you see | What to do |
| --- | --- |
| `list_recordings` is empty | Recording was off when the request ran, or the route did not compile. Check `get_system_logs`, then repeat step 3. |
| `This run has no span 9` | Use a `seq` from the span list of that run. |
| The failing span says `truncated` | Its input or output was cut at 8 KB. Reproduce with a smaller input. |
| `Not found` on `get_recording` | `kind` and `targetId` must be the route or workflow that made the run. |
