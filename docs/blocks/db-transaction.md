---
title: DB Transaction
description: Wrap multiple database operations in a transaction.
---

# DB Transaction

The **DB Transaction** block ensures that a set of database operations either all succeed or all fail together. This is critical for maintaining data integrity (e.g., deducting money from one account and adding it to another).

To cancel the transaction on purpose, use the [Rollback Transaction](./db-rollback.md) block inside the executor chain.

## Inputs

- **Connection**: The database integration.
- **Executor**: The chain of blocks to run inside the transaction.

## Outputs

| Handle | Runs when | Input to the next block |
| --- | --- | --- |
| **Success** | the transaction committed | the last output of the **Executor** chain |
| **Failure** | the transaction rolled back | `{ reason: "rollback" \| "error", message }` |

- `reason` is `"rollback"` when a [Rollback Transaction](./db-rollback.md) block ran, and `"error"` when a block in the executor chain threw.
- `message` is the rollback block's message, or the error text (including its cause, e.g. `failed to execute insert db block: duplicate key value ...`).

## Logic

1.  The block starts a database transaction.
2.  It runs the blocks in the **Executor** chain.
3.  If they all succeed, it commits (saves the changes) and continues on **Success**.
4.  If a block fails, or a **Rollback Transaction** block runs, it rolls back (undoes every change) and continues on **Failure**.

If a block inside the executor chain sends a **Response**, the transaction commits and that response is returned right away.

### When nothing is connected to Failure

- An **error** fails the run, as with any other block, so the [Error Handler](./error-handler.md) still receives it.
- A **rollback** ends the run quietly.

## Example: reject large orders

```
Entrypoint → DB Transaction
               ├─ executor → DB Insert (orders) → If (total <= 1000)
               │                                   └─ failure → Rollback Transaction
               ├─ success  → Response 201   (input: the inserted row)
               └─ failure  → Response 409   (input: { reason, message })
```

The insert runs first; when the total is over the limit the rollback undoes it, and the caller gets a 409 with the reason.

## Canvas checks

- **Error**: the Success or Failure path leads into blocks that also run inside the Executor chain. Keep the inside and the after paths separate.
- **Warning**: a Rollback Transaction block can be reached outside the Executor chain. See [Rollback Transaction](./db-rollback.md).
