---
title: DB Insert
description: Add a new record to a database.
---

# DB Insert

The **DB Insert** block adds a new row of data to a specific table.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to add data to.
- **Data**:
    - **Source**: Choose "raw" to build the object manually or "js" to provide a JavaScript object.
    - **Value**: The actual data fields and values to insert.
- **Use Param**: If checked, uses the output of the previous block as the data to insert.
- **On conflict** (optional): What to do when a row with the same unique value already exists. See below.

## Logic

1.  The block constructs the data object from **Data** or the previous block.
2.  It inserts this new record into the **Table Name**.
3.  It returns the result (often the created record or its ID).

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
