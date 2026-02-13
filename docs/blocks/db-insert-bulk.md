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

## Logic

1.  The block takes the list of objects.
2.  It inserts all of them into the **Table Name** efficiently.
3.  It returns the result of the bulk operation.
