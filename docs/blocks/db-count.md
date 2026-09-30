---
title: DB Count
description: Count the records that match your conditions.
---

# DB Count

The **DB Count** block counts the records in a table that match your conditions and passes on that number. Use it for "how many active orders does this rider have?", or to show a total next to a paginated list, without loading every row.

## When to use it

- Show a total next to a list, like "128 results".
- Check a limit before you allow something, like "fewer than 5 open tickets".
- Don't use it just to know whether something exists. [DB Row Exists](./db-row-exists.md) is built for that.
- Don't use it when you need the records too. [DB Get All](./db-get-all.md) gives you the list, and its length.

## Inputs

The same fields as [DB Get Single](/blocks/db-get-single#inputs), without **Columns**.

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to count in. |
| **Conditions** | No | none (every record) | Rules that pick the records to count, see [DB Conditions](/blocks/db-conditions). A condition whose value is `undefined` is skipped. |
| **Joins** | No | none | Other tables to combine, SQL only. See [DB Joins](/blocks/db-joins). |
| **Save output to variable** | No | off | Store the number in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The count worked. The next block receives a number, for example `3`. It is `0` when nothing matches. |

## Example

How many active orders does rider `7` have?

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `orders` |
| Conditions | `rider_id` `=` `7` **AND** `status` `=` `active` |

The next block receives `3`. Use it in a [Response](./response.md) body or an [If Condition](./if-condition.md).

## How it behaves

- **No conditions counts every record** in the table.
- **With joins, each joined row counts once.** A user with two orders counts twice when you join `orders`.
- **MongoDB has no joins yet.** A graph with joins on a MongoDB connection can't be saved.
- **A missing table:** on MongoDB, a collection that doesn't exist counts as `0`. On PostgreSQL and MySQL, a missing table is an error.
- **Database errors** (bad connection, missing table or column) go to the [Error Handler](./error-handler.md).
- **It replaces the flowing data** with the number.

## Related blocks

- [DB Get All](./db-get-all.md): load the records too.
- [DB Row Exists](./db-row-exists.md): only check whether any record exists.
- [DB Conditions](./db-conditions.md) and [DB Joins](./db-joins.md): the filter and join options in detail.
