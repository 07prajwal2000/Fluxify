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
| **JS** | Yes | none | The code to run. It can call `dbQuery(query, params?)` (or use `db` on MongoDB) and must `return` the result. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

- **SQL (PostgreSQL, MySQL):** `dbQuery(query, params?)` runs the query and returns the result rows as a list.
- **MongoDB:** use `db` and `ObjectId` instead. See [MongoDB](/blocks/db-native#mongodb) below.

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
- **Inside a transaction,** the query is part of the [DB Transaction](./db-transaction.md) it runs in. On MongoDB this covers every `db.collection(...)` read and write.
- **Value types** follow the other DB blocks. For example, `COUNT(*)` is a number and a `DECIMAL` is text. See [Value types](/integrations/databases#value-types).
- **No safety net.** The query runs exactly as written. A `DELETE` without `WHERE` deletes everything.
- **It replaces the flowing data** with what you return.

## Passing values safely

Never put user input straight into the query text. Pass it in the `params` array and use a placeholder instead:

| Database | Placeholder |
| --- | --- |
| PostgreSQL | `$1`, `$2`, … |
| MySQL | `$1`, `$2`, … or `?` |

`$1` is the first value in `params`, `$2` the second, and so on. The same number can appear more than once. The placeholders work the same on both databases. On MySQL, use either `$1` or `?` in one query, not both. A `$1` inside quotes, like `'$1'` or the JSON path `'$.name'`, is plain text and not a placeholder.

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

## MongoDB

On a MongoDB connection, the code gets two things instead of `dbQuery`:

| Name | What it is |
| --- | --- |
| `db` | The database, already connected, from the official [MongoDB driver](https://www.mongodb.com/docs/drivers/node/current/crud/). |
| `ObjectId` | Builds document ids: `new ObjectId("665f…")`. |

```javascript
const id = new ObjectId(getRouteParam("id"));
await db.collection("orders").updateOne({ _id: id }, { $set: { status: "paid" } });
return await db.collection("orders").findOne({ _id: id });
```

- **Inside a [DB Transaction](./db-transaction.md),** every `db.collection(...)` read and write joins the transaction on its own. If the transaction rolls back, the writes are undone. Commands on `db` itself (like `db.command(...)`) and index changes don't join it.
- **`dbQuery("...")` with a query throws on MongoDB**, with the message "dbQuery takes SQL; on MongoDB use db.collection(...)". Older code that calls `await dbQuery()` with nothing still works: it returns the same `db`.
- The code editor knows the driver's types, so `db.` suggests methods as you type.
- **Ids from other blocks are text.** The other DB blocks give and take ids as text. Turn text into an id with `new ObjectId(text)`, and turn an id back into text with `id.toHexString()` before you return it. See [MongoDB ids](/integrations/databases#ids).

### Joining collections

The other DB blocks can't join on MongoDB. Use MongoDB's `$lookup` here instead. This returns each order with its rider nested under `rider`:

```javascript
return await db.collection("orders").aggregate([
  { $match: { status: "open" } },
  { $lookup: { from: "riders", localField: "riderId", foreignField: "_id", as: "rider" } },
  { $unwind: { path: "$rider", preserveNullAndEmptyArrays: true } },
]).toArray();
```

- **Leave out `preserveNullAndEmptyArrays`** to drop orders with no rider, like an inner join. With it, they stay with no `rider`, like a left join.
- **Both fields must hold the same type.** An id saved as text never matches an ObjectId. Store ids as ObjectIds, or convert one side with `$toObjectId`.
- The results keep MongoDB's own types, so ids come back as ObjectIds. Call `.toHexString()` on one to get text.

## Related blocks

- [DB Get All](./db-get-all.md) and [DB Get Single](./db-get-single.md): the no-code way to read.
- [DB Transaction](./db-transaction.md): run native queries together with other changes.
- [JS Runner](./js-runner.md): JavaScript without database access.
