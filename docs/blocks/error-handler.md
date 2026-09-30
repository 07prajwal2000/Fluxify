---
title: Error Handler
description: Choose what happens when any block in the flow fails.
---

# Error Handler

The **Error Handler** block is your safety net. When any block in the flow fails, the run jumps here instead of stopping, and continues with the blocks you connected after it. They receive the error message as their `input`.

## When to use it

- Send a clean, friendly error response instead of a raw error message.
- Log the failure, or tell another system, before you answer.
- Don't use it for normal "no" answers, like "user not found". The **Failure** path of [If Condition](./if-condition.md) or [DB Row Exists](./db-row-exists.md) is for that. Those are not errors, so the Error Handler doesn't run for them.

## Inputs

None. There is nothing to configure. You only connect what should run next.

The block has no input handle. You don't connect blocks to it. Fluxify jumps to it on its own when a block fails.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Connect the first block to run after a failure. It receives the error message as text, for example `"Error: connection refused"`. |

## Example

A route reads an order from the database. If the database is down, answer with a clean `500`.

1. Add an **Error Handler** to the canvas.
2. Connect its **Next** handle to a [Response](./response.md) block with code `500`.
3. Turn on **Transform response** in the Response block and use:

```js
return { message: "Could not load your order", reason: input };
```

When the database call fails, the caller gets a `500` with:

```json
{ "message": "Could not load your order", "reason": "Error: connection refused" }
```

## How it behaves

- **One per canvas.** It covers the whole flow, including blocks inside loops and branches.
- **It catches failures, not wrong answers.** A block that fails (a bad query, a thrown JS error, a refused connection) triggers it. A block that simply returns an empty result does not.
- **The run does not go back.** After the error path, the flow does not resume where it failed.
- **End the path with a Response.** Without one, the route answers `500` with `{ "error": ... }`, built from the last block's output. A [Response](./response.md) block gives you control of the status code and body.
- **No Error Handler at all.** The route stops and answers `500` with `{ "error": "<message>" }`.
- **A failure inside the error path.** If a block after the Error Handler fails too, the route fails with a `500`. Keep the error path short and simple.

## Related blocks

- [Response](./response.md): send a custom error status and message.
- [If Condition](./if-condition.md): branch on an expected "no" without an error.
- [Console Log](./console-log.md): record what went wrong.
- [Cloud Logs](./cloud-logs.md): send failures to an external log service.
