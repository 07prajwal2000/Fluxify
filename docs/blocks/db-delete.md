---
title: DB Delete
description: Delete records from a database.
---

# DB Delete

The **DB Delete** block removes records from your database table based on specific conditions.

## Inputs

- **Connection**: The specific database integration to use.
- **Table Name**: The name of the table to delete from.
- **Conditions**: Rules to identify which records to delete (e.g., "id equals 5"). A condition whose value is `undefined` is skipped, and the **Custom** operator lets you write the condition yourself — see [Operators](/blocks/db-get-all#operators), [Optional filters](/blocks/db-get-all#optional-filters) and [Custom conditions](/blocks/db-get-all#custom-conditions).

::: warning
If every condition is skipped, **every record** in the table is deleted.
:::

## Logic

1.  The block connects to the database.
2.  It identifies rows in the **Table Name** that match the **Conditions**.
3.  It permanently removes those rows.
4.  It outputs the result of the operation.
