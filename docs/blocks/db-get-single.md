---
title: DB Get Single
description: Retrieve a single record from a database.
---

# DB Get Single

The **DB Get Single** block fetches exactly one record from a table. This is best used when you are looking up a specific item by its unique ID.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to query.
- **Conditions**: Rules to find the specific record.

## Logic

1.  The block searches the **Table Name**.
2.  It finds the first record that matches the **Conditions**.
3.  It returns that single record object.
