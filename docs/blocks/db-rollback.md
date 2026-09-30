---
title: Rollback Transaction
description: Cancel the enclosing DB Transaction and undo everything it changed.
---

# Rollback Transaction

The **Rollback Transaction** block cancels the [DB Transaction](./db-transaction.md) it runs inside. Every change made in the transaction so far is undone, and the transaction continues on its **Failure** handle.

## When to use it

- Undo the work because your own logic says it must not be saved: a stock check fails, a balance would go negative.
- Stop part-way without throwing an error or writing raw JS.
- Don't use it outside a transaction. It has nothing to undo there, and the run fails.
- Don't use it for normal errors. A block that fails already rolls the transaction back on its own.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Message** | No | `transaction rolled back` | A reason handed to the transaction's failure path as `message`. Supports `js:` expressions, e.g. `js:return 'order total ' + input.total + ' is over the limit';`. |

## Outputs

None. The block ends the **Executor** chain and has no **Next** handle. What happens next is decided on the transaction's **Failure** handle, which receives:

```json
{ "reason": "rollback", "message": "<your message>" }
```

If the transaction has nothing connected to **Failure**, the run just ends.

## Example

Reject an order that is over the limit, inside a [DB Transaction](./db-transaction.md):

1. [DB Insert](./db-insert.md) saves the order.
2. [If Condition](./if-condition.md) checks `input.total <= 1000`. Its **Failure** path leads to **Rollback Transaction** with the message `js:return 'order total ' + input.total + ' is over the limit';`.

The insert is undone, and the transaction's **Failure** path receives `{ "reason": "rollback", "message": "order total 1500 is over the limit" }`. Connect a `409` [Response](./response.md) there.

## How it behaves

- **Only inside a transaction's Executor chain,** at any depth: after an If, inside a loop, and so on.
- **Everything is undone,** not only the last step.
- **On the canvas,** a rollback that can be reached outside a transaction shows a warning.
- **At run time,** a rollback outside a transaction fails the run with `rollback block ran outside a database transaction`.
- **A rollback is not an error.** With nothing connected to **Failure**, the run ends quietly and the [Error Handler](./error-handler.md) does not run.

## Related blocks

- [DB Transaction](./db-transaction.md): the block this one cancels.
- [If Condition](./if-condition.md): decide when to roll back.
- [Response](./response.md): tell the caller what happened.
