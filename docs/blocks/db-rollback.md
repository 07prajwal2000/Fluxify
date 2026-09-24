---
title: Rollback Transaction
description: Cancel the enclosing database transaction on purpose.
---

# Rollback Transaction

The **Rollback Transaction** block cancels the [DB Transaction](./db-transaction.md) it runs inside. Every change made in the transaction so far is undone, and the transaction continues on its **Failure** handle.

Use it when your own logic decides the work must not be saved — a stock check fails, a balance would go negative — without throwing an error or writing raw JS.

## Inputs

- **Message** (optional): a reason handed to the transaction's failure path as `message`. Supports `js:` expressions, e.g. `js:return 'order total ' + input.total + ' is over the limit';`. Defaults to `transaction rolled back`.

## Outputs

None. The block stops the executor chain. Handle what comes next on the transaction's **Failure** handle, which receives:

```json
{ "reason": "rollback", "message": "<your message>" }
```

If the transaction has nothing connected to **Failure**, the run just ends.

## Where it can go

Only inside a transaction's **Executor** chain, at any depth (after an If, inside a loop, ...).

- On the canvas, a rollback that can be reached outside a transaction shows a warning.
- At run time, a rollback outside a transaction fails the run with `rollback block ran outside a database transaction`.
