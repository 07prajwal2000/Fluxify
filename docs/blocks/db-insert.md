---
title: DB Insert
description: Add one new record to a database table, or update it if it already exists.
---

# DB Insert

The **DB Insert** block adds one new record to a table and passes the created record on. With **On conflict** it can also update an existing record instead, so you can "insert or update" in one step.

## When to use it

- Save a new user, order or message that came from a request.
- Keep one row per thing with the latest values, like a rider's last position, by using **On conflict**.
- Don't use it to add many records at once. [DB Insert Bulk](./db-insert-bulk.md) does that in one go and is much faster than a loop.
- Don't use it to change a record you already know exists. Use [DB Update](./db-update.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to add to. Can be a JS expression. |
| **Data** | Yes, unless **Use Param** is on | none | The record to add. **Source** `raw`: fill in the fields one by one, and each value can be a `js:` expression. **Source** `js`: write JavaScript that returns the object. |
| **Use Param** | No | off | On: insert the previous block's output, which must be an object, instead of **Data**. |
| **On conflict** | No | off | What to do when a record with the same unique value already exists. See below. |
| **Save output to variable** | No | off | Store the created record in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The insert worked. The next block receives the created record, including values the database filled in, like the new `id`. |

With **On conflict** set to **Skip it**, and a record that already existed, the output is `null`.

## Example

Save a new user from a sign-up request.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `users` |
| Data (raw) | `email` = `js: input.email`, `name` = `js: input.name` |

If the previous block output `{ "email": "ada@example.com", "name": "Ada" }`, the next block receives:

```json
{ "id": 12, "email": "ada@example.com", "name": "Ada" }
```

## How it behaves

- **The data must be an object.** Anything else fails the block with `data to insert is not an object`.
- **A failed insert is an error.** A duplicate value in a unique column, a missing required column or a wrong type fails the block, and the [Error Handler](./error-handler.md) runs.
- **Inside a transaction,** the insert is part of the [DB Transaction](./db-transaction.md) and is undone if it rolls back.
- **Values from a request are data,** not code. With **Use Param**, an object from the request can never run as a `js:` expression.
- **It replaces the flowing data** with the created record.

## On conflict (insert or update)

Turn on **On conflict** to "insert this row, or update it if it already exists" in one step. A common example is keeping one row per rider with their latest position.

- **Match on**: The unique column(s) that identify a row, e.g. `riderId` or `email`.
- **If it exists**:
    - **Update it**: Overwrites the existing row. The block returns the row as it is now.
    - **Skip it**: Leaves the existing row alone. The block returns `null`, so the next blocks can tell a duplicate was skipped.
- **Columns to update**: Which columns to overwrite. Leave empty to overwrite every inserted column except the ones in **Match on**.

A column can also [increment or decrement](./db-update.md#increment-and-decrement) on update, e.g. `{ "riderId": 7, "deliveries": { "op": "inc", "value": 1 } }`. A new row starts at the amount (for `dec`, its negative).

Example: with **Match on** `email`, inserting `{ "email": "ada@example.com", "name": "Ada King" }` renames Ada if she exists, or adds her if she does not.

::: warning Every database needs a unique column
- **PostgreSQL**: the **Match on** columns must have a unique index or constraint, or the block fails with a message naming the missing one.
- **MySQL**: a duplicate is detected on *any* unique column of the table. **Match on** is used to find the row again. Skipping runs one extra read first.
- **MongoDB**: add a unique index on the **Match on** fields, otherwise two requests at the same moment can both insert.
:::

## Related blocks

- [DB Insert Bulk](./db-insert-bulk.md): add many records at once.
- [DB Update](./db-update.md): change existing records.
- [DB Row Exists](./db-row-exists.md): check for a duplicate first.
- [DB Transaction](./db-transaction.md): make several writes succeed or fail together.
