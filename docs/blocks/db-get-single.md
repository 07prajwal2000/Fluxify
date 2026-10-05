---
title: DB Get Single
description: Fetch exactly one record from a database table, like a lookup by id or email.
---

# DB Get Single

The **DB Get Single** block looks up one record in a table and passes it on. When several records match, it returns the first one, in the order you choose.

## When to use it

- Look up one item by a unique value: an id, an email, a token.
- Find the newest or oldest record, by sorting and taking the first.
- Don't use it for lists. [DB Get All](./db-get-all.md) returns many records.
- Don't use it only to check that something exists. [DB Row Exists](./db-row-exists.md) gives a success and a failure path in one block.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to read. |
| **Conditions** | No | none (any record) | Rules that find the record, see [DB Conditions](/blocks/db-conditions). A condition whose value is `undefined` is skipped. |
| **Joins** | No | none | Other tables to combine, SQL only. See [DB Joins](/blocks/db-joins). |
| **Columns** | No | every column | Which columns to return, see [Columns](/blocks/db-get-single#columns). |
| **Sort** | No | none | Which record to pick when several match, for example `created_at` Desc for the newest. Works like [DB Get All's sort](/blocks/db-paging-sorting#sort). |
| **Strict: exactly one match** | No | off | On: fail the block when more than one record matches, instead of returning one of them. |
| **Save output to variable** | No | off | Store the record in `outputs.<name>`. |

Turn **Strict** on for lookups that should be unique, like an id, email or token. A duplicate then shows up as an error, rather than as a silently wrong record.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The query worked. The next block receives the record as an object, or `null` when nothing matches. |

## Example

Load the user behind a session cookie.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `sessions` |
| Conditions | `token` `=` `js:input` |
| Columns | `user_id`, `expires_at` |

If the session exists, the next block receives:

```json
{ "user_id": 7, "expires_at": "2030-01-01T00:00:00.000Z" }
```

If it doesn't, the next block receives `null`. Use an [If Condition](./if-condition.md) to check it, for example with **Is Empty/Null**.

## Columns

By default every column is returned. To narrow the result, list the columns you want:

- `name`: a plain column.
- `books.title`: a column qualified by table (needed once you add a join).
- `books.title AS bookTitle`: rename a column in the output.
- `books.*`: every column from one table in a join.

## How it behaves

- **No match is `null`, not an error.** The flow continues on **Next** with a `null` input, so always handle the empty case.
- **Without a sort, any matching record may come back.** Set **Sort** when several records can match and you care which one you get.
- **Strict fails on duplicates.** With **Strict** on and more than one match, the block fails and the [Error Handler](./error-handler.md) runs. No match still returns `null`.
- **Database errors** (bad connection, missing table or column) go to the [Error Handler](./error-handler.md).
- **MongoDB:** joins are skipped. To combine collections, use a [DB Native](/blocks/db-native#joining-collections) block.
- **It replaces the flowing data.** The next block's `input` is the record, not what came before. Use **Save output to variable** to keep both.

## Related blocks

- [DB Get All](./db-get-all.md): fetch a list.
- [DB Row Exists](./db-row-exists.md): branch on whether a record exists.
- [DB Conditions](./db-conditions.md) and [DB Joins](./db-joins.md): the filter and join options in detail.
- [DB Update](./db-update.md): change the record you found.
- [If Condition](./if-condition.md): react to a missing record.
