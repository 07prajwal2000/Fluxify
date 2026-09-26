---
title: DB Insert Bulk
description: Add multiple records to a database at once.
---

# DB Insert Bulk

The **DB Insert Bulk** block allows you to add a list of records to a table in a single operation, which is much faster than adding them one by one.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to add data to.
- **Data**: A list (array) of objects to insert.
- **Use Param**: If checked, uses the list passed from the previous block.
- **Run Inside a Transaction**: If checked, all records are saved or none are. On by default for new blocks.

## Logic

1.  The block takes the list of objects.
2.  It inserts all of them into the **Table Name** efficiently, in batches.
3.  It returns the inserted records.

## All or nothing

Large lists are saved in several batches. With **Run Inside a Transaction** checked, if any batch fails (for example, a duplicate email), none of the records are kept, so you can safely retry.

With it unchecked, batches saved before the failure stay in the table, and the block still fails.

::: info
Inside a **DB Transaction** block, the bulk insert always joins that transaction, whether or not the box is checked.
:::

::: tip MongoDB
MongoDB supports transactions only on a replica set. On a standalone server, the records are inserted without a transaction, as if the box were unchecked.
:::
