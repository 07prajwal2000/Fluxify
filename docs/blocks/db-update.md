---
title: DB Update
description: Modify existing records in a database.
---

# DB Update

The **DB Update** block modifies data in existing rows of your table.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to update.
- **Conditions**: Rules to find which records to update. A condition whose value is `undefined` is skipped, and the **Custom** operator lets you write the condition yourself — see [Optional filters](/blocks/db-get-all#optional-filters) and [Custom conditions](/blocks/db-get-all#custom-conditions).

::: warning
If every condition is skipped, **every record** in the table is updated.
:::
- **Data**: The new values to apply.
- **Use Param**: If checked, uses the previous block's output as the update data.

## Logic

1.  The block identifies rows in **Table Name** that match **Conditions**.
2.  It applies the changes defined in **Data** to those rows.
3.  It returns the result of the update operation.
