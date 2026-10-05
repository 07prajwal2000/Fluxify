---
title: DB Get All
description: Fetch a list of records from a database table, with filters, sorting and paging.
---

# DB Get All

The **DB Get All** block reads many records from a table and passes them on as a list. You can filter them, sort them, pick the columns, join related tables, and read them page by page.

## When to use it

- Return a list to the caller: users, orders, products.
- Load the records you then go through with a [For Each Loop](./foreach-loop.md).
- Build a paginated endpoint, with a limit and offset or with a cursor.
- Don't use it to look up one record by its id. [DB Get Single](./db-get-single.md) is made for that.
- Don't use it just to count. [DB Count](./db-count.md) counts without loading every row.
- Don't use it to check if something exists. [DB Row Exists](./db-row-exists.md) gives you a success and a failure path.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to read. |
| **Conditions** | No | none (all records) | Rules that pick the records, see [DB Conditions](/blocks/db-conditions). A condition whose value is `undefined` is skipped. |
| **Joins** | No | none | Other tables to combine, SQL only. See [DB Joins](/blocks/db-joins). |
| **Columns** | No | every column | Which columns to return, see [Columns](/blocks/db-get-all#columns). |
| **Sort** | No | primary key order | The order of the records. See [Sorting and paging](/blocks/db-paging-sorting). |
| **Paging** | No | Offset | **Offset** or **Cursor**. See [Sorting and paging](/blocks/db-paging-sorting#paging). |
| **Limit** | No | `1000` | The most records to return. `-1` means no limit. |
| **Offset** | No | `0` | How many records to skip. Offset paging only. |
| **After** | No | empty | Where a cursor page starts. Cursor paging only. |
| **Tiebreaker columns** | No | primary key | Cursor paging only. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

Limit, Offset and After accept a JS expression, for example `js:getQueryParam('limit')`.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The query worked. The next block receives the records. |

- With **Offset** paging, the output is a list: `[{ ... }, { ... }]`. It is an empty list `[]` when nothing matches.
- With **Cursor** paging, the output is `{ "rows": [...], "nextCursor": "..." }`. `nextCursor` is `null` on the last page.

## Example

A `GET /users?status=active` route lists active users, newest first, 20 at a time.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `users` |
| Conditions | `status` `=` `js:getQueryParam('status')` |
| Columns | `id`, `name`, `email` |
| Sort | `created_at` Desc |
| Limit | `20` |

Result passed to the next block:

```json
[{ "id": 9, "name": "Avery", "email": "avery@example.com" }, { "id": 4, "name": "Kai", "email": "kai@example.com" }]
```

Without `?status=`, the condition is skipped and users of every status come back.

## Columns

By default every column is returned. To narrow the result, list the columns you want:

- `name`: a plain column.
- `books.title`: a column qualified by table (needed once you add a join).
- `books.title AS bookTitle`: rename a column in the output.
- `books.*`: every column from one table in a join.

## How it behaves

- **No match is not an error.** The output is an empty list, and the flow continues on **Next**.
- **A limit always applies.** With no **Limit**, at most 1000 records are returned.
- **`-1` loads everything.** On a big table that can be slow and use a lot of memory. Use cursor paging to read a large table page by page.
- **A bad limit or offset fails the block.** Text that isn't a whole number, such as `abc`, stops the block with an error that names the value.
- **Ties keep a stable order.** The primary key is added as the last sort, so pages never repeat or skip a record.
- **Database errors** (bad connection, missing table or column) go to the [Error Handler](./error-handler.md).
- **MongoDB:** joins are skipped. To combine collections, use a [DB Native](/blocks/db-native#joining-collections) block. `id` means `_id` unless the documents have their own `id`. See [MongoDB ids](/integrations/databases#ids).
- Very large whole numbers and decimals come back as text, and dates as `Date` in UTC. See [Value types](/integrations/databases#value-types).

## Related blocks

- [DB Get Single](./db-get-single.md): fetch one record.
- [DB Count](./db-count.md): count matching records.
- [DB Conditions](./db-conditions.md), [DB Joins](./db-joins.md) and [DB Sorting and Paging](./db-paging-sorting.md): the details of the filter, join and paging options.
- [For Each Loop](./foreach-loop.md): go through the records one by one.
- [Response](./response.md): send the list back to the caller.
