---
title: Recipe - try blocks with an ephemeral run
description: One tool call that runs a few blocks on a development worker, answers with the result and the blocks that ran, and saves nothing, with its limits and the setting that makes the agent ask first.
---

# Recipe - try blocks with an ephemeral run

Goal: find out what a few blocks do, in **one** call, and leave nothing behind. No sandbox is made, no canvas is saved and no recording is kept. Use it for a quick check ("what does this expression return?", "does this query run?"). If you will come back to the blocks, use a [sandbox](/agents/recipes/inspect-data-in-sandbox) or a real route instead.

Needs: a running development worker. The blocks run on the project's **development** values, so they can still read and write development data.

## 1. Call `run_blocks`

Name your blocks with a `ref` you choose, and connect them with `edges`:

```json
{
  "projectId": "<project id>",
  "blocks": [
    { "ref": "sum", "type": "jsrunner",
      "data": { "value": "return { total: [1, 2, 3].reduce((a, b) => a + b, 0) + getRequestBody().extra };" } },
    { "ref": "reply", "type": "response", "data": { "httpCode": "200" } }
  ],
  "edges": [{ "from": "sum", "to": "reply" }],
  "input": { "extra": 10 }
}
```

What to know:

- The **entrypoint** and the **error handler** are added for you. Don't put them in `blocks`. The entrypoint is connected to the first block that nothing else points at.
- `input` is the request body the blocks read. `method`, `path` and `headers` are optional and work like in `call_sandbox`.
- A block with more than one output handle (such as `if`) needs a `handle` on its edges: `"from": "check.success"` or `"handle": "success"`. `get_block_schemas` lists each block's handles.
- Block text inputs are literal unless they start with `js:`, as on any canvas.

To run a canvas that already exists, leave out `blocks` and `edges` and give `from` instead: `{ "kind": "route", "id": "<route id>" }` (or a workflow, a custom block or your own sandbox of this project). Add `keys` to run only those blocks. The saved canvas is not changed.

## 2. Read the answer

| Field | What it is |
| --- | --- |
| `status`, `headers`, `body` | What the blocks answered. `body` is cut at 10,000 characters. |
| `durationMs` | How long the run took. |
| `trace` | One line per block that ran, by your refs: `sum (jsrunner) ok 3ms → {"total":16}`. |
| `error` | When a block failed: its ref, the message and the real stack. |
| `warnings` | Canvas rule warnings that did not stop the run. |
| `id` | Names the run's log entry (see below). |

A graph that is not valid is refused before anything runs, with the reasons, such as an unknown block type or an edge to a block that does not exist. It is checked by the same rules as saving a canvas.

## 3. Fix and go again

Change the blocks and call `run_blocks` again. There is nothing to clean up.

## What is kept

Nothing is saved, with one exception: each run writes **one system log** of type `ephemeral`, with the blocks that ran, the output (or the error and its stack), the duration and the environment. Read it with `get_system_logs` (`type: "ephemeral"`, or `resourceId` set to the run's `id`).

- Only the person who ran it can read it, even a project admin cannot.
- An output over 64 KB is cut, with a note saying so.
- It is deleted after the same number of days as recordings (30 by default).

## Limits

| Limit | Value |
| --- | --- |
| How long a run may take | 10 seconds by default. A call can pass `timeoutSeconds` (1 to 30; anything outside is brought inside). A project can change the default in **Project settings → AI configuration → Ephemeral runs**. |
| What it can run | Route-style blocks, once, as a request. It does not run as a workflow. |
| Who can run it | A creator, in a project with a development worker. Never production. |

A run that goes past the limit stops waiting and answers with an error saying so. The blocks may still be finishing on the worker, so check before you run something that writes data again.

## Ask before every run

In **Project settings → AI configuration → Ephemeral runs**, turn on **Ask before ephemeral runs**. The agent then waits for your approval before every `run_blocks`, in auto mode too. It is off by default.

## Common problems

| What you see | What to do |
| --- | --- |
| `start a worker with FLUXIFY_ENV=development` | No development worker is running. Ask the person to start one. |
| `Unknown block type` | Use a built-in block type from `get_block_schemas`, or a custom block's name from `list_custom_blocks`. |
| `several handles: pass handle as one of ...` | The block has more than one output. Add `handle` to the edge. |
| `The run did not finish within N seconds` | Give the blocks less to do, or pass a larger `timeoutSeconds` (up to 30). |
| `Nothing to start from` | Every block is the target of an edge. Leave one block that nothing points at. |
