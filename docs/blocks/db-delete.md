---
title: DB Delete
description: Permanently remove the records that match your conditions.
---

# DB Delete

The **DB Delete** block permanently removes records from a table. It passes on how many records it deleted, and what they looked like just before.

## When to use it

- Remove something the user asked to delete, like a comment or an account.
- Clean up expired data, like old sessions or tokens.
- Don't use it when you may want the data back. Mark the record as deleted with [DB Update](./db-update.md) instead. A delete can't be undone (unless it runs inside a [DB Transaction](./db-transaction.md) that rolls back).
- Don't use it without conditions unless you mean to empty the table. See the warning below.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to delete from. |
| **Conditions** | No | none (**every** record) | Rules to find the records to delete, for example `id` equals `5`. See [DB Conditions](/blocks/db-conditions). A condition whose value is `undefined` is skipped. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

::: warning Skipped conditions delete every record
If every condition is skipped, **every record** in the table is deleted. Make sure at least one condition always has a value.
:::

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The delete worked. The next block receives `{ count, affected }`. |

```json
{ "count": 2, "affected": [{ "id": 4, "status": "cancelled" }, { "id": 9, "status": "cancelled" }] }
```

- `count`: how many records were deleted. `0` when nothing matched.
- `affected`: the deleted records, as they were just before the delete.

## Example

Delete a comment, but only when it belongs to the caller.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `comments` |
| Conditions | `id` `=` `js:getRouteParam('id')` **AND** `author_id` `=` `js:userId` |

If the comment doesn't exist or belongs to someone else, the next block receives `{ "count": 0, "affected": [] }`. Add an [If Condition](./if-condition.md) with `input.count === 0` that leads to a `404` [Response](./response.md).

## How it behaves

- **No match is not an error.** The output is `{ "count": 0, "affected": [] }`.
- **Every deleted record is returned,** so deleting a large table returns a large output.
- **Database errors** (bad connection, missing table or column) go to the [Error Handler](./error-handler.md).
- **It replaces the flowing data** with the result.

## Related blocks

- [DB Update](./db-update.md): mark a record as deleted instead of removing it.
- [DB Transaction](./db-transaction.md): make a delete succeed or fail together with other changes.
- [DB Conditions](./db-conditions.md): how to pick the records.
- [If Condition](./if-condition.md): answer `404` when nothing was deleted.
