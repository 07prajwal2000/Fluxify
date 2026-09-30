---
title: DB Update
description: Change values in the records that match your conditions.
---

# DB Update

The **DB Update** block changes the values of existing records in a table. It passes on how many records changed, and what they look like now.

## When to use it

- Change a status, like marking an order as `cancelled`.
- Save edits from a `PATCH` or `PUT` request.
- Add to or subtract from a number safely, like stock or points, with increment and decrement.
- Don't use it to create records. Use [DB Insert](./db-insert.md), or its **On conflict** option to "insert or update".
- Don't use it without conditions unless you mean to change every record. See the warning below.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to update. |
| **Conditions** | No | none (**every** record) | Rules to find the records to update, see [DB Conditions](/blocks/db-conditions). A condition whose value is `undefined` is skipped. |
| **Data** | Yes, unless **Use Param** is on | none | The new values. Each field can be set, incremented or decremented. |
| **Use Param** | No | off | On: use the previous block's output as the update data. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

::: warning Skipped conditions update every record
If every condition is skipped, **every record** in the table is updated. Make sure at least one condition always has a value.
:::

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The update worked. The next block receives `{ count, affected }`. |

```json
{ "count": 1, "affected": [{ "id": 4, "status": "cancelled" }] }
```

- `count`: how many records **actually changed**. `0` when nothing matched.
- `affected`: the changed records, as they are after the update.

## Example

Cancel order `4`, but only if it isn't cancelled yet.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `orders` |
| Conditions | `id` `=` `4` |
| Data | `status` = `cancelled` |

The next block receives `{ "count": 1, "affected": [{ "id": 4, "status": "cancelled" }] }`. Add an [If Condition](./if-condition.md) that checks `input.count === 0` and leads to a `409` [Response](./response.md) for an order that was already cancelled.

## How it behaves

- **Only real changes count.** A record that matches but already holds the new values is not counted and not returned. Setting `status` to `"cancelled"` on an order that is already cancelled gives `count: 0`.
- **No match is not an error.** The output is `{ "count": 0, "affected": [] }`.
- **Database errors** (bad connection, missing table or column) go to the [Error Handler](./error-handler.md).
- **It replaces the flowing data** with the result.

::: info Tables without a primary key
On PostgreSQL and MySQL, if the table has no primary key, every record that matches the conditions is counted and returned, even one that already held the new values.
:::

## Increment and decrement

To add to a number instead of replacing it, pick **Increment** or **Decrement** as the field's type in **Data** and enter the amount (a number, or a `js:` expression that returns one).

With **Custom JavaScript** or **Use Param**, return the same thing as an object:

```json
{
  "points": { "op": "inc", "value": 10 },
  "stock":  { "op": "dec", "value": "js:return getRequestBody().qty;" }
}
```

- `inc` adds `value`, `dec` subtracts it. Any other value still means "set".
- The database does the math, so two runs at the same moment both count. Reading the value, adding in JavaScript and writing it back can lose one of them.
- `value` must be a number. Text such as `"3"` fails the block, so convert query params first (`Number(...)`).

## Related blocks

- [DB Insert](./db-insert.md): add records, or insert-or-update.
- [DB Get Single](./db-get-single.md): read the record before you change it.
- [DB Transaction](./db-transaction.md): make several updates succeed or fail together.
- [DB Conditions](./db-conditions.md): how to pick the records.
