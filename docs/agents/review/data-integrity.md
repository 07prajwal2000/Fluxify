---
title: Review recipe - data integrity
description: Data integrity checks for a route or workflow canvas, covering writes with no transaction, updates and deletes with no filter, and steps that are not safe to run twice.
---

# Review recipe - data integrity

Category: `data_integrity`. These problems lose or corrupt data, often only when something fails or runs twice.

## Several writes with no transaction

- **Look for:** two or more writes that must all happen or none (an order and its lines, a debit and a credit) outside a DB Transaction.
- **Severity:** `error` for money, stock or ownership. `warning` otherwise.
- **Fix:** put the writes inside a DB Transaction, and use DB Rollback on the paths that must undo.

## Update or delete with no filter

- **Look for:** a DB Update or DB Delete with empty conditions, conditions that can be empty at run time (a filter value from optional input), or DB Native `UPDATE` or `DELETE` with no `WHERE`.
- **Severity:** `error`.
- **Fix:** require the filter value in the request schema, and check it before the write.

## Check then write (race)

- **Look for:** a read that checks something (stock left, a unique email, a balance), then a separate write that relies on it, with no transaction, constraint or conditional update.
- **Severity:** `warning`.
- **Fix:** do the check inside the write (a conditional update or a unique constraint), or inside a DB Transaction.

## Step not safe to run twice

- **Look for:** a workflow, a trigger-fed flow or a Retry-wrapped chain that inserts, charges, sends a message or calls an outside API without an idempotency key or an "already done" check. Retries and redelivered queue messages run it again.
- **Severity:** `warning`. Make it `error` for payments.
- **Fix:** check for the earlier result first, upsert instead of insert, or pass an idempotency key to the outside API.

## Outside call inside a transaction

- **Look for:** an HTTP Request, message send or AI call inside a DB Transaction. A rollback cannot undo it, and a slow call holds locks.
- **Severity:** `warning`.
- **Fix:** make the outside call after the transaction commits, or record it and send it from a workflow.

## Partial writes left behind

- **Look for:** a flow that writes, then calls something that can fail, with no undo or "pending" status when it does.
- **Severity:** `warning`.
- **Fix:** write a pending status first and complete it at the end, or undo on the Error Handler path.
