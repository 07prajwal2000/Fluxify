---
title: DB Native
description: Run raw queries or custom database code.
---

# DB Native

The **DB Native** block gives you direct access to the database driver using JavaScript. This offers maximum flexibility for complex queries that standard blocks can't handle.

## Inputs

- **Connection**: The database integration.
- **JS**: The JavaScript code to execute. You have access to a `dbQuery(query, params?)` function.
- **MongoDB**: For MongoDB, you need to call `dbQuery()` and it will return the raw `db` connection instance. Please refer to the [MongoDB documentation](https://www.mongodb.com/docs/drivers/node/current/crud/) for more information on how to use `db` object. 

## Logic

1.  The block executes your **JS** code.
2.  You can write raw SQL queries using `dbQuery(query, params?)`.
3.  `dbQuery` returns the result rows as an array.
4.  The return value of your code is returned as the block output.

## Passing values safely

Never put user input straight into the query text. Pass it in the `params` array and use a placeholder instead:

| Database | Placeholder |
| --- | --- |
| PostgreSQL | `$1`, `$2`, … |
| MySQL | `?` |

```javascript
const search = getQueryParam("q");
const users = await dbQuery(
  "SELECT id, username, email FROM users WHERE username = $1 LIMIT 20",
  [search],
);
return users; // [{ id: 1, username: "john", email: "john@example.com" }]
```

::: warning
Writing `` `... WHERE username = ${search}` `` puts the raw text into the SQL. A value like `john:doe` then breaks the query with a syntax error, and a crafted value can change what the query does (SQL injection). Placeholders avoid both.
:::

Always `await` the call. Without it you get a pending promise instead of rows.
