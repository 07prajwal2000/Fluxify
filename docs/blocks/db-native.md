---
title: DB Native
description: Run your own SQL or database commands from JavaScript, when the other DB blocks can't express the query.
---

# DB Native

The **DB Native** block gives you direct access to your database with JavaScript. Write a raw SQL query (or, for MongoDB, use the driver) for anything the other DB blocks can't do, and the value you return goes to the next block.

## When to use it

- Write a query the standard blocks can't, like `GROUP BY`, window functions, unions, or database-specific features.
- Call a stored procedure, or run a one-off maintenance command.
- Don't use it for simple reads and writes. [DB Get All](./db-get-all.md), [DB Insert](./db-insert.md) and friends are safer, easier to read, and work on every database.
- Don't build the query text from user input. Always use placeholders, see below.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **JS** | Yes | none | The code to run. It can call `dbQuery(query, params?)` and must `return` the result. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

- **SQL (PostgreSQL, MySQL):** `dbQuery(query, params?)` runs the query and returns the result rows as a list.
- **MongoDB:** `dbQuery()` returns the raw `db` connection. See the [MongoDB driver docs](https://www.mongodb.com/docs/drivers/node/current/crud/) for how to use it.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The code finished. The next block receives whatever your code `return`s. |

## Example

Count orders per status.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| JS | see below |

```javascript
const rows = await dbQuery(
  "SELECT status, COUNT(*) AS total FROM orders WHERE created_at > $1 GROUP BY status",
  [getQueryParam("since")],
);
return rows;
```

The next block receives:

```json
[{ "status": "paid", "total": 12 }, { "status": "pending", "total": 3 }]
```

## How it behaves

- **You must `return` the result.** Without `return`, the next block receives nothing.
- **Always `await` the call.** Without it you get a pending promise instead of rows.
- **Errors fail the block.** A bad query, a missing table or a lost connection goes to the [Error Handler](./error-handler.md).
- **Inside a transaction,** the query is part of the [DB Transaction](./db-transaction.md) it runs in.
- **Value types** follow the other DB blocks. For example, `COUNT(*)` is a number and a `DECIMAL` is text. See [Value types](/integrations/databases#value-types).
- **No safety net.** The query runs exactly as written. A `DELETE` without `WHERE` deletes everything.
- **It replaces the flowing data** with what you return.

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

## Related blocks

- [DB Get All](./db-get-all.md) and [DB Get Single](./db-get-single.md): the no-code way to read.
- [DB Transaction](./db-transaction.md): run native queries together with other changes.
- [JS Runner](./js-runner.md): JavaScript without database access.
