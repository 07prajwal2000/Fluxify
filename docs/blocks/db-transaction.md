---
title: DB Transaction
description: Run several database changes as one unit: they all succeed, or none of them are saved.
---

# DB Transaction

The **DB Transaction** block makes a chain of database blocks succeed or fail together. If every block works, the changes are saved. If one fails, every change made in the chain is undone. This keeps your data correct, for example when you take money from one account and add it to another.

## When to use it

- Change more than one record or table and they must stay in step: orders and stock, payments and balances.
- Undo everything when your own logic says no, with a [Rollback Transaction](./db-rollback.md) block.
- Don't use it for a single insert, update or delete. One statement is already all-or-nothing.
- Don't put slow or one-off work inside it, like an [HTTP Request](./http-request.md) that sends an email. It runs again on every retry, and it keeps the transaction open. Do that on the **Success** path instead.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Executor** (top handle) | Yes | none | Connect the first block of the chain that runs inside the transaction. |
| **Timeout (ms)** (Advanced tab) | No | `30000` | How long the whole transaction may take, retries included. See [Timeout](/blocks/db-transaction#timeout). |
| **Retries** (Advanced tab) | No | `0` | How many more times to try after a deadlock or a conflict with another request. See [Retries](/blocks/db-transaction#retries). |
| **Isolation level** (Advanced tab) | No | Database default | How strictly this transaction is kept apart from others running at the same time. See [Isolation level](/blocks/db-transaction#isolation-level). |
| **Save output to variable** | No | off | Store the result of a committed transaction in `outputs.<name>`. |

## Outputs

| Handle | Runs when | Input to the next block |
| --- | --- | --- |
| **Success** (right) | The transaction committed. | The last output of the **Executor** chain. |
| **Failure** (right) | The transaction rolled back. | `{ reason: "rollback" \| "error" \| "timeout", message }` |
| **Executor** (top) | Always, first. | Connect the chain to run inside the transaction. |

- `reason` is `"rollback"` when a [Rollback Transaction](./db-rollback.md) block ran, `"timeout"` when the transaction took longer than its **Timeout**, and `"error"` when a block in the executor chain threw.
- `message` is the rollback block's message, or the error text (including its cause, e.g. `failed to execute insert db block: duplicate key value ...`).

## Example: reject large orders

```
Entrypoint → DB Transaction
               ├─ executor → DB Insert (orders) → If (total <= 1000)
               │                                   └─ failure → Rollback Transaction
               ├─ success  → Response 201   (input: the inserted row)
               └─ failure  → Response 409   (input: { reason, message })
```

The insert runs first. When the total is over the limit, the rollback undoes it, and the caller gets a `409` with the reason.

## How it behaves

1. The block starts a database transaction.
2. It runs the blocks in the **Executor** chain.
3. If they all succeed, it commits (saves the changes) and continues on **Success**.
4. If a block fails, or a **Rollback Transaction** block runs, it rolls back (undoes every change) and continues on **Failure**.

If a block inside the executor chain sends a **Response**, the transaction commits and that response is returned right away.

### When nothing is connected to Failure

- An **error** or a **timeout** fails the run, as with any other block, so the [Error Handler](./error-handler.md) still receives it.
- A **rollback** ends the run quietly.

### Timeout

The timeout covers the whole transaction, from start to commit, including every retry. When it runs out:

1. The transaction is rolled back, so none of its changes are saved.
2. The block continues on **Failure** with `{ reason: "timeout", message: "transaction timed out after 30000ms" }`.
3. Blocks of the executor chain that are still running can no longer reach the database. One that tries fails with `the transaction timed out and was rolled back`.

A query that is already running when the timeout passes is allowed to finish first (each query has its own limit, the connection's [query timeout](/integrations/databases#query-timeout)), so the Failure path can start a little after the timeout.

### Retries

When two requests change the same rows at the same time, the database can stop one of them with a **deadlock** or a **serialization failure**. These are normal under load, and trying again usually works. Set **Retries** to have the block try again on its own after a short pause.

- Only deadlocks, serialization failures and lock wait timeouts are retried. Any other error goes straight to **Failure**.
- When every attempt fails, the block continues on **Failure** with reason `"error"`.

::: warning A retry runs the whole executor chain again
Every block in the executor chain runs again, not only the database ones. An **HTTP request** block inside the chain sends its request again on every retry. Keep calls that must happen only once outside the transaction, for example on the **Success** path.
:::

### Isolation level

| Level | What it means |
| --- | --- |
| **Database default** | What your database does normally (PostgreSQL: read committed, MySQL: repeatable read). Right for most flows. |
| **Read committed** | Each query sees the data other requests have already saved. |
| **Repeatable read** | Reading the same rows twice gives the same result within the transaction. |
| **Serializable** | The transaction behaves as if it ran alone. Use it for "check, then write" flows, such as "book the seat only if it is still free". Pair it with **Retries**, because the database stops a conflicting transaction instead of letting both through. |

MongoDB has no isolation levels. Leave the setting on **Database default** for a MongoDB connection; any other value is refused when you save the canvas.

### MongoDB

MongoDB transactions need a replica set. On a single standalone server the transaction fails with `MongoDB transactions need a replica set`. See [Database Integrations](/integrations/databases#mongodb).

### Nested transactions

A transaction inside another one's executor chain must use a **different connection**. On the same connection the inner transaction is refused with `nested transactions on the same connection are not supported`: the outer one rolls back and takes its **Failure** path, and the canvas shows an error on the inner block. A canvas with this wiring cannot be saved.

## Canvas checks

Errors block saving the canvas; warnings do not, so a half-built canvas still saves.

- **Error**: the Success or Failure path leads into blocks that also run inside the Executor chain. Keep the inside and the after paths separate.
- **Error**: a transaction sits inside another transaction on the same connection.
- **Error**: an isolation level is set on a MongoDB connection.
- **Error**: the timeout is not a whole number above 0, or retries is not a whole number from 0 to 10.
- **Warning**: a Rollback Transaction block can be reached outside the Executor chain. See [Rollback Transaction](./db-rollback.md).
- **Warning**: nothing is connected to the **Executor** handle, so the transaction does nothing.

## Related blocks

- [Rollback Transaction](./db-rollback.md): cancel the transaction from inside the chain.
- [DB Insert](./db-insert.md), [DB Update](./db-update.md) and [DB Delete](./db-delete.md): the writes you usually group.
- [If Condition](./if-condition.md): decide whether to roll back.
- [Error Handler](./error-handler.md): receives errors and timeouts when **Failure** has nothing connected.
