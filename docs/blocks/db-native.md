---
title: DB Native
description: Run raw queries or custom database code.
---

# DB Native

The **DB Native** block gives you direct access to the database driver using JavaScript. This offers maximum flexibility for complex queries that standard blocks can't handle.

## Inputs

- **Connection**: The database integration.
- **JS**: The JavaScript code to execute. You have access to a `dbQuery(query: string)` function.
- **MongoDB**: For MongoDB, you need to call `dbQuery()` and it will return the raw `db` connection instance. Please refer to the [MongoDB documentation](https://www.mongodb.com/docs/drivers/node/current/crud/) for more information on how to use `db` object. 

## Logic

1.  The block executes your **JS** code.
2.  You can write raw SQL queries using `dbQuery(query: string)`.
3.  The return value of your code is returned as the block output.
