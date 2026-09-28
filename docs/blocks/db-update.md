---
title: DB Update
description: Modify existing records in a database.
---

# DB Update

The **DB Update** block modifies data in existing rows of your table.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to update.
- **Conditions**: Rules to find which records to update. A condition whose value is `undefined` is skipped, and the **Custom** operator lets you write the condition yourself — see [Operators](/blocks/db-get-all#operators), [Groups](/blocks/db-get-all#groups-brackets), [Optional filters](/blocks/db-get-all#optional-filters) and [Custom conditions](/blocks/db-get-all#custom-conditions).

::: warning
If every condition is skipped, **every record** in the table is updated.
:::
- **Data**: The new values to apply.
- **Use Param**: If checked, uses the previous block's output as the update data.

## Logic

1.  The block identifies rows in **Table Name** that match **Conditions**.
2.  It applies the changes defined in **Data** to those rows.
3.  It outputs how many rows changed, and those rows after the update.

## Output

```json
{ "count": 1, "affected": [{ "id": 4, "status": "cancelled" }] }
```

- `count`: how many rows **actually changed**. `0` when nothing matched.
- `affected`: the changed rows, as they are after the update.

A row that matches the conditions but already holds the new values is **not** counted and not returned. For example, setting `status` to `"cancelled"` on an order that is already cancelled gives `count: 0`.

That makes rules like "cancel only if not cancelled yet" simple: update, then an **If** block with `input.count === 0` leading to a 409.

::: info Tables without a primary key
On PostgreSQL and MySQL, if the table has no primary key, every row that matches the conditions is counted and returned, even one that already held the new values.
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
