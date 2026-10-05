---
title: Response
description: Send the final answer back to the caller and end the flow.
---

# Response

The **Response** block ends the flow and sends the result back to whoever called your route. The body of the response is the data that reached the block, and you choose the status code.

## When to use it

- Finish an API route: return the data you built, with `200`, `201` or another status.
- Pick the status while the flow runs, like `201` when a record was created and `200` when it was updated.
- Answer with an error on purpose, like `400` for bad input or `404` for a missing record.
- Don't look for one in a workflow's logic. A workflow runs in the background with nobody waiting, so there is no caller to answer. There the block just ends the workflow and the status code is ignored.
- Don't use it to show the caller an unexpected crash. Let the [Error Handler](./error-handler.md) decide that.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Status code** | Yes | `200` | The status code to return. Pick it from the list (type `404` or `not found` to search), or use JS to work it out while the flow runs. See below. |
| **Transform response** | No | off | Reshape the body just before it is sent. See below. |
| **Transform** tab | Only when transform is on | empty | A script that receives the body as `input` and returns what to send. |

The body is the output of the block before it, so there is no body field to fill in.

### Status code from JS

Press the **JS** button on the status code field to compute the code instead of picking one.

- The code gets the body as `input`, like any other JS field, and must `return` the status code.
- Return it as a number (`201`) or as text (`"201"`). Both work.
- The code must be one from the list. Anything else, like `999`, `"abc"` or nothing at all, fails the block, and the [Error Handler](./error-handler.md) runs. A bad status code is never sent.

```js
return input.created ? 201 : 200;
```

### Transform response

Turn on **Transform response** to change the shape of the body without adding a [JS Runner](./js-runner.md) block.

- It is off by default, so existing responses stay the same.
- Write the script in the **Transform** tab. The body comes in as `input`, and whatever you `return` is sent.
- The status code is still the one from the status code field.

```js
return { data: input, meta: { count: input.length } };
```

### In an after middleware

In a block that runs as an [after middleware](../concepts/middlewares.md#what-each-step-receives),
the first `input` is not the body. It is the route's whole reply: `{ httpCode, body }`.
A Response block sends whatever reaches it, so without a transform the caller
gets that wrapper, status code included.

Turn on **Transform response** and send the body instead, changed if you like:

```js
return { ...input.body, servedBy: "fluxify" };
```

If an earlier block in the chain already reshaped `input`, the route's reply is
still there: `getResponseBody()` returns its body and `getResponseStatus()` its
status code. See [Response values](../scripting/javascript-api.md#response-values).

::: warning The status code is the Response block's own
The Response block answers with its own code, not the route's. To pass a route's
`404` through, set the status code with JS to `return getResponseStatus();`.
:::

## Outputs

None. A Response block is the end of the flow and has no **Next** handle. Nothing placed after it would ever run.

## Example

The previous block returned a list of users. Send them back wrapped with a count.

| Field | Value |
| --- | --- |
| Http Code | `200` |
| Transform response | on |

Transform script:

```js
return { users: input, total: input.length };
```

The caller receives status `200` and this body:

```json
{ "users": [{ "id": 1 }, { "id": 2 }], "total": 2 }
```

## How it behaves

- **Ends everything.** As soon as the flow reaches a Response, the route ends. Other work still running, like the other branches of an [Orchestrator](./orchestrator.md), is ignored.
- **Works inside loops and branches.** A Response inside a [For Each Loop](./foreach-loop.md) ends the whole route on the first round it reaches.
- **Empty body.** If nothing reached the block, or the body is `null`, the body is sent as `null`.
- **Headers and cookies.** Anything set earlier with [Set HTTP Header](./set-http-header.md) or [Set HTTP Cookie](./set-http-cookie.md) goes out with the response.
- **No Response block.** If the flow ends without one, the route answers `200` with the last block's output. With no output at all, the body is the text `NO RESULT`. Add a Response block so the answer is always clear.
- **Transform errors.** If the transform script throws an error, the block fails and the [Error Handler](./error-handler.md) runs.
- **Bad status code from JS.** If the status code JS returns a code that is not in the list, the block fails with an error naming the value, and the [Error Handler](./error-handler.md) runs.
- **Files cannot be sent directly.** JSON has no way to represent a file. Read what you need from it and send that.

### Example: created or updated

An upsert reports whether it created the record. Send `201` for a new record and `200` for an update.

| Field | Value |
| --- | --- |
| Status code | JS: `return input.created ? 201 : 200;` |

When the previous block outputs `{ "id": 7, "created": true }`, the caller receives status `201` with that body. With `"created": false` the status is `200`.

## Related blocks

- [Error Handler](./error-handler.md): choose the response when something fails.
- [If Condition](./if-condition.md): send a different status on each path.
- [Set HTTP Header](./set-http-header.md) and [Set HTTP Cookie](./set-http-cookie.md): add to the response before it goes out.
- [Transformer](./transformer.md): reshape data earlier in the flow.
