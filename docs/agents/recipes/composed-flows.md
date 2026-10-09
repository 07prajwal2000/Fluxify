---
title: Recipe - composed flows
description: Canvas patterns with exact edit_canvas ops, check then update or 404, retry around a flaky call, an error handler that returns JSON 500, and a response status set at run time.
---

# Recipe - composed flows

Patterns you combine on a route canvas. Every step is an `edit_canvas` call. Read the [Canvas guide](/agents/canvas) first for handles, refs and validation. Validate input with the route schemas, not with blocks: [Validate a request](/agents/recipes/validate-request).

In every example, blocks are named by the keys `get_canvas` shows (`entrypoint_1`, `response_1`; yours may differ), and `version` is the one you just read. A new route has an edge from the entrypoint to its 200 response. When you put blocks in between, add `{ "op": "disconnect", "from": "entrypoint_1", "to": "response_1" }` as the first op, because a handle holds one edge. Block text inputs are literal unless they start with `js:`; code fields (`transformScript`, JS Runner `value`) never take `js:`. See [Dynamic values and `js:` expressions](/agents/expressions).

## 1. Check, then update or answer 404

Goal: `PUT /users/:id` with `{ "name": "..." }` updates the user, or answers 404 when the id does not exist.

First give the route schemas (`save_route`): `paramsSchema` with `id` as `int`, and `bodySchema` with `name` as a required `str`.

The flow: read the body, look the user up, branch.

1. `httpgetrequestbody` reads the body. Its output is the body itself.
2. `db_exists` looks the user up. It replaces `input` with the found row, so the body would be gone. Save the body first with `saveAsVariable`.
3. On `success`, `db_update` writes the new name. On `failure`, a response answers 404.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 0,
  "ops": [
    { "op": "disconnect", "from": "entrypoint_1", "to": "response_1" },
    { "op": "add_block", "ref": "body", "type": "httpgetrequestbody",
      "data": { "blockName": "Read body", "saveAsVariable": { "enabled": true, "name": "payload" } },
      "connect_from": { "from": "entrypoint_1" } },
    { "op": "add_block", "ref": "find", "type": "db_exists",
      "data": {
        "blockName": "User exists",
        "connection": "<integration id>",
        "tableName": "users",
        "conditions": [
          { "attribute": { "kind": "column", "value": "id" }, "operator": "eq",
            "value": { "kind": "literal", "value": "js: return getRouteParam('id');" }, "chain": "and" }
        ],
        "saveAsVariable": { "enabled": true, "name": "user" }
      },
      "connect_from": { "from": "body" } },
    { "op": "add_block", "ref": "update", "type": "db_update",
      "data": {
        "connection": "<integration id>",
        "tableName": "users",
        "conditions": [
          { "attribute": { "kind": "column", "value": "id" }, "operator": "eq",
            "value": { "kind": "literal", "value": "js: return getRouteParam('id');" }, "chain": "and" }
        ],
        "data": { "source": "raw", "value": { "name": "js: return outputs.payload.name;" } },
        "useParam": false
      },
      "connect_from": { "from": "find", "handle": "success" } },
    { "op": "connect", "from": "update", "to": "response_1" },
    { "op": "update_block", "id": "response_1",
      "data": { "transformEnabled": true,
                "transformScript": "return { id: outputs.user.id, name: outputs.payload.name };" } },
    { "op": "add_block", "ref": "missing", "type": "response",
      "data": { "httpCode": "404", "transformEnabled": true,
                "transformScript": "return { error: 'User not found' };" },
      "connect_from": { "from": "find", "handle": "failure" } }
  ]
}
```

Why `saveAsVariable` here: `payload` keeps the body past `db_exists`, and `user` keeps the found row for the response. Without them the body would be lost. `db_exists` saves the row on `success` and `null` on `failure`, so read `outputs.user` only on the success path. See [Save output to variable](/agents/canvas#save-output-to-variable).

Check it with `call_route` for an id that exists (expect 200) and one that does not (expect 404). Both are good test suite cases.

`db_update` outputs `{ count, affected }`, and a row that already holds the values is not counted. Do not answer 404 from `count`: the row exists.

## 2. Retry a flaky call

Goal: call an outside API, retry on failure, answer 502 when every try failed.

The `retry` block runs the chain on its `executor` handle. If the chain throws, it runs again up to `maxRetries` more times with a wait between tries. `success` gets the chain's last output; `failure` gets `{ attempts, message }`. Retrying a write can run it more than once, so wrap only calls that are safe to repeat.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 0,
  "ops": [
    { "op": "disconnect", "from": "entrypoint_1", "to": "response_1" },
    { "op": "add_block", "ref": "retry", "type": "retry",
      "data": { "maxRetries": 3, "retryType": "exponential", "delayMs": 500, "maxDelayMs": 5000 },
      "connect_from": { "from": "entrypoint_1" } },
    { "op": "add_block", "ref": "call", "type": "httprequest",
      "data": { "url": "https://api.example.com/status", "method": "GET", "headers": {}, "body": null, "useParam": false },
      "connect_from": { "from": "retry", "handle": "executor" } },
    { "op": "connect", "from": "retry", "to": "response_1", "handle": "success" },
    { "op": "update_block", "id": "response_1",
      "data": { "transformEnabled": true, "transformScript": "return input.data;" } },
    { "op": "add_block", "ref": "bad-gateway", "type": "response",
      "data": { "httpCode": "502", "transformEnabled": true,
                "transformScript": "return { error: 'Upstream failed', attempts: input.attempts };" },
      "connect_from": { "from": "retry", "handle": "failure" } }
  ]
}
```

- The block at the end of the executor chain (`call`) has no outgoing edge. Its output is the chain's output.
- The `httprequest` output is `{ data, status }`, so the 200 response reads `input.data`.
- With nothing on `failure`, the last error fails the route and the error handler runs instead.

Looping: `foreachloop` and `forloop` run their `executor` chain once per item or index and output `undefined` after the loop. Keep per-item results with a Set Variable or Array Operations block, or `saveAsVariable` inside the chain. Put a `retry` block inside the loop's executor chain to retry each item.

## 3. An error handler that returns JSON 500

Goal: any unhandled error answers a clean JSON 500 instead of the generic failure.

The error handler block is already on the canvas. Give its `source` handle an edge to the first block of the error flow. That block gets the error as text for `input`, like `Error: <message>`.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 0,
  "ops": [
    { "op": "add_block", "ref": "fail", "type": "response",
      "data": { "httpCode": "500", "transformEnabled": true,
                "transformScript": "return { error: 'Something went wrong' };" },
      "connect_from": { "from": "error_handler_1" } }
  ]
}
```

Do not put the raw `input` (the error text) in the body if it could hold internals such as SQL. To see the real cause while you build, use `call_route`, which returns `error`, or [record a run](/agents/recipes/debug-and-fix).

## 4. A response status set at run time

The response block's `httpCode` is a fixed code like `"404"`, or `js:` code that returns one. It must return a known HTTP code; an unknown code throws, and the error handler runs.

From the previous block's output:

```json
{ "op": "update_block", "id": "response_1",
  "data": { "httpCode": "js: return input.created ? 201 : 200;" } }
```

From a variable set earlier. A Set Variable block assigns `statusCode`, and the response reads it by its bare name:

```json
{ "op": "add_block", "ref": "pick", "type": "setvar",
  "data": { "key": "statusCode", "value": "js: return input.ok ? 200 : 422;" },
  "connect_from": { "from": "<previous block>" } }
```

```json
{ "op": "update_block", "id": "response_1", "data": { "httpCode": "js: return statusCode;" } }
```

From a saved output: `"httpCode": "js: return outputs.check.ok ? 200 : 422;"`.

Mistakes that break it:

| Wrong | Why |
| --- | --- |
| `"httpCode": "js: input.ok ? 200 : 422"` | No `return`. The value is `undefined`. |
| `"httpCode": "input.ok ? 200 : 422"` | No `js:` prefix. It is a literal and fails the save. |
| `"httpCode": "js: return 'ok';"` | Not a known HTTP code. The block throws at run time. |

An error case that needs a different status can also use a second response block on a branch (like the 404 above). Use a dynamic status when one response block serves several outcomes.

## Common problems

| What you see | What to do |
| --- | --- |
| `... has no "failure" handle` | Only branching blocks have `success` and `failure`. A plain block uses `source`. See the [Canvas guide](/agents/canvas#blocks-handles-and-edges). |
| The update ran with the wrong body | After `db_exists` the `input` is the row. Read the body from `outputs.payload`. |
| A TypeError on `outputs.x` | The block that saves `x` did not run on this path. Read it only after it. |
| 404 for a row that exists | `db_exists` matched nothing: check the condition and the id's type in `paramsSchema`. |
