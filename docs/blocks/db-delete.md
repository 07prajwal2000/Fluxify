---
title: DB Delete
description: Delete records from a database.
---

# DB Delete

The **DB Delete** block removes records from your database table based on specific conditions.

## Inputs

- **Connection**: The specific database integration to use.
- **Table Name**: The name of the table to delete from.
- **Conditions**: Rules to identify which records to delete (e.g., "id equals 5").

## Logic

1.  The block connects to the database.
2.  It identifies rows in the **Table Name** that match the **Conditions**.
3.  It permanently removes those rows.
4.  It outputs the result of the operation.
