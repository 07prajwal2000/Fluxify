---
title: Recipe - debug a route in a sandbox
description: Step by step tool calls that copy a route into your own sandbox, try a fix there on development data, and copy the fixed blocks back into the route, with what is not copied.
---

# Recipe - debug a route in a sandbox

Goal: find and fix a problem in a route without touching the live route until the fix works. You copy the route into a sandbox (your own private canvas that runs on development data), change it there as often as you like, and then copy only the fixed blocks back.

Needs: a running development worker, and the Creator role in the project. Copying is always inside **one project**: you cannot copy a canvas into another project.

## 1. Copy the route into a new sandbox

Call `copy_blocks` with `to` set to `"__new_sandbox__"`:

```json
{
  "projectId": "<project id>",
  "from": { "kind": "route", "id": "<route id>" },
  "to": "__new_sandbox__"
}
```

With no `keys`, the whole canvas is copied. Fluxify makes a sandbox named `<route name> sandbox`, copies every block and the connections between them, and connects the sandbox's entrypoint to the first block. The route is not changed.

The answer has:

| Field | What it is |
| --- | --- |
| `target` | The new sandbox: `kind`, `id` and `name`. |
| `keys` | Each copied block's key on the route, and the key its copy got in the sandbox. |
| `warnings` | What was **not** copied, or may not work (see the table at the end). |
| `issues` | Canvas rule warnings for the copy, such as two blocks with one name. |

Read the `warnings` before you go on.

## 2. Call the sandbox

Call `call_sandbox` with the same method, path, query and body that failed on the route:

```json
{
  "projectId": "<project id>",
  "sandboxId": "<sandbox id>",
  "method": "POST",
  "path": "/orders",
  "body": { "qty": 0 }
}
```

The answer has `status`, `body`, `error` (the block that failed and why) and `trace` (the blocks that ran). To use a real failed request, read it from the route's recording with `get_recording` and copy its method, path, query, headers and body.

::: tip Try it without copying
To only run the route's blocks once and keep nothing, call `run_blocks` with `from: { "kind": "route", "id": "<route id>" }` instead of `blocks`. Add `keys` to run only some of them. See [Try blocks with an ephemeral run](/agents/recipes/ephemeral-run).
:::

## 3. Fix it in the sandbox

Read the sandbox canvas with `get_canvas` (target `{ "kind": "sandbox", "id": "<sandbox id>", "projectId": "<project id>" }`) and change it with `edit_canvas`, using `edit_code` for script changes. Call it again after each change until it answers the way the route should.

## 4. Copy the fix back

Copy only the blocks you fixed, and say where they attach. `connect_from` is a block that is **already on the route**; the copy is connected after it:

```json
{
  "projectId": "<project id>",
  "from": { "kind": "sandbox", "id": "<sandbox id>" },
  "keys": ["jsrunner_2", "response_3"],
  "to": { "kind": "route", "id": "<route id>" },
  "connect_from": { "from": "if_1", "handle": "success" }
}
```

The copy gets new keys, and the answer says which. The route keeps its old blocks: use `edit_canvas` to remove the ones the copy replaces and to connect the copy to the rest of the route. Then run the route with `call_route` or a test suite.

::: warning Copying into a route asks first
Copying into a route, workflow or custom block asks the person to approve, even when the agent is set to run without asking. Copying into a sandbox does not ask in that mode.
:::

You can also do this by hand in the portal: select the blocks in the sandbox, copy, and paste them on the route's canvas.

## 5. Clean up

Delete the sandbox with `delete_sandbox` when you are done.

## What is not copied

| What | Why | What to do |
| --- | --- | --- |
| The route's middlewares | They are route settings, not blocks. | Nothing: a sandbox runs without them. Copy back only blocks. |
| The route's request schemas (body, query, params) | They are route settings. A sandbox accepts any body. | Send a body that would pass the route's schema. |
| The entrypoint and the error handler | Every canvas has its own. | Nothing. |
| A connection to a block you did not copy | It would point at nothing. | Connect the copy with `connect_from` or `edit_canvas`. |
| Inputs of a custom block | They only exist inside the custom block. | When the source is a custom block, read the request body (or the run payload) instead. |

## Common problems

| What you see | What to do |
| --- | --- |
| `That route is in another project` | `copy_blocks` stays inside one project. Copy by hand in the portal, or rebuild it with `edit_canvas`. |
| `Not found` on a sandbox | It is someone else's, or it was deleted. `list_sandboxes` lists only yours. |
| `already goes to` in a refusal | The `connect_from` block's handle is taken. `disconnect` it first with `edit_canvas`, then copy. Nothing was changed. |
| `No block ... on that canvas` | The key is wrong. Read the canvas again with `get_canvas`. |
| `start a worker with FLUXIFY_ENV=development` | No development worker is running. Ask the person to start one. |
