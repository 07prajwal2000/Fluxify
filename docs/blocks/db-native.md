---
title: DB Native
description: Run raw queries or custom database code.
---

# DB Native

The **DB Native** block gives you direct access to the database driver using JavaScript. This offers maximum flexibility for complex queries that standard blocks can't handle.

## Inputs

- **Connection**: The database integration.
- **JS**: The JavaScript code to execute. You have access to a `dbQuery(query)` function.

## Logic

1.  The block executes your **JS** code.
2.  You can write raw SQL queries using `dbQuery`.
3.  The result of your code is returned as the block output.
