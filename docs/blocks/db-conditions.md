---
title: DB Conditions
description: How to filter records in the DB blocks: operators, groups, optional filters and custom conditions.
---

# DB Conditions

Conditions decide **which records** a database block reads, updates or deletes. The same editor is used by [DB Get All](./db-get-all.md), [DB Get Single](./db-get-single.md), [DB Row Exists](./db-row-exists.md), [DB Count](./db-count.md), [DB Update](./db-update.md) and [DB Delete](./db-delete.md).

## Operators

| Operator | Value | Matches records where the column… |
| --- | --- | --- |
| `=` `!=` `>` `>=` `<` `<=` | one value | compares to the value |
| **in** / **not in** | a list | is / is not one of the values |
| **contains** / **starts with** / **ends with** | text | contains / starts with / ends with the text, ignoring upper and lower case |
| **between** | two values: min, max | is between the two, **including both ends** |
| **is null** / **is not null** | none | has no value / has a value |
| **exists** / **not exists** | none | has the field at all (MongoDB only) |

**Lists** (for *in*, *not in* and *between*) can be typed as comma-separated text — `active, pending` — or come from an expression that returns an array, such as `js:getRequestBody().ids`. Use an expression when a value itself contains a comma.

- An empty list with **in** matches nothing, and with **not in** matches everything.
- A list may not contain `null`, and **between** needs exactly two values; either mistake stops the block with an error instead of quietly matching the wrong records. To match empty values, use **is null**.
- **not in** never matches a record whose value is empty (`null`) — the same on every database. Add an **Or** *is null* condition if you want those too.

**Text** operators treat every character literally: searching for `50%` or `a_b` finds exactly that text, not a pattern.

**Empty values:** `= null` works the same as **is null**, and `!= null` the same as **is not null**.

::: info Database differences
- **MongoDB:** *is null* also matches documents that don't have the field at all. Use **exists** / **not exists** to tell the two apart.
- **MongoDB:** *in* compares values exactly as typed, so the text `"7"` does not match the number `7`. Pass numbers from an expression (`js:[7, 10]`) when the field holds numbers. *between* always compares numbers as numbers.
- **MongoDB:** text operators only match fields that hold text.
- **MySQL:** whether text matching ignores upper and lower case depends on the column's collation. The default one does. Fields inside JSON always ignore case.
:::

## Groups (brackets)

Conditions combine **strictly left to right**: each one joins everything before it with its **AND** / **OR**. There is no "AND before OR" rule, so `a OR b AND c` means `(a OR b) AND c`.

To put brackets somewhere else, use **Add Group**. A group's conditions combine first, and then the group joins the list like a single condition.

| You want | Build it as |
| --- | --- |
| `status = active AND (role = admin OR role = owner)` | `status = active`, then **Add And Group** with `role = admin` **OR** `role = owner` |
| `(age < 18 OR age > 65) AND city = Paris` | a group with `age < 18` **OR** `age > 65`, then **Add And Condition** `city = Paris` |

- **Open** a group to edit it. The breadcrumb at the top shows how deep you are; click any part of it to go back up.
- Groups can hold groups, with no depth limit.
- From above, a group shows a one-line summary and how many of its conditions are still empty.
- A group works the same way in **DB Get Single**, **DB Update** and **DB Delete**.
- [Optional filters](/blocks/db-conditions#optional-filters) work inside groups: a group whose conditions are all skipped is skipped too, and so is an empty group.

## Optional filters

A condition is **skipped** when its value is `undefined` when the block runs. This lets one block serve both "filter" and "don't filter" without any branching.

Example: a condition `status` `=` `js:getQueryParam('status')`.

| Request | What runs |
| --- | --- |
| `/users?status=active` | only records with `status = active` |
| `/users` | every record — the condition is left out |

`null` is **not** skipped: it is a real value, so a condition with a `null` value still filters.

::: warning Update and Delete
The same rule applies to **DB Update** and **DB Delete**. If every condition is skipped (including every condition inside groups), the block updates or deletes **every record** in the table. Make sure at least one condition always has a value.
:::

## Filtering nested / JSON fields

If a column stores JSON data (for example a Postgres `jsonb` column or a MongoDB document field), you can filter and sort on the values inside it using plain JavaScript-style access:

- Use a dot to reach into a key: `attributes.age`
- Use brackets to reach into a list: `tags[0]`, `items[0].name`

Example: a condition on `attributes.age` with operator `>=` and value `18` returns only records where the `age` field inside `attributes` is 18 or higher. This works the same way whether the value is stored as a number or as a numeric-looking string.

The value side of a condition can also point at a field instead of a fixed value — for example, checking that `attributes.age` is greater than or equal to `attributes.minAge` compares two fields on the same record. This has to be marked explicitly as a field reference; otherwise the value is always compared as-is, so an ordinary value that happens to contain dots (an email address, a version number, a domain) is matched exactly and never mistaken for a field name.

::: info MongoDB
Comparing two fields against each other is only available on SQL databases.
:::

## Custom conditions

When the [built-in operators](/blocks/db-conditions#operators) are not enough — JSON or array operators, regular expressions, full-text search — pick the **Custom** operator and write the condition yourself. The editor follows your connection's database.

### SQL databases (PostgreSQL, MySQL)

Write any expression that could appear after `WHERE`. Put run-time values inside `{{ }}`:

```sql
tags @> {{ input.tags }}
```

```sql
created_at > NOW() - INTERVAL '7 days' AND total > {{ input.minTotal }}
```

- Whatever is inside `{{ }}` is JavaScript, with the same variables and helpers as any other expression.
- Each `{{ }}` value is sent to the database **separately from the SQL text**, so a value can never change the query. Do not add quotes around `{{ }}`.
- If any `{{ }}` value is `undefined`, the whole condition is skipped (see [Optional filters](/blocks/db-conditions#optional-filters)).
- The text is used exactly as written, so it must be valid for your database (for example `ILIKE` exists in PostgreSQL but not MySQL).

### MongoDB

Write JavaScript that **returns a MongoDB query filter object** — the same object you would pass to `find()`:

```js
return { tags: { $all: input.tags } };
```

```js
return { $expr: { $gt: ["$spent", "$budget"] } };
```

- Returning `undefined` skips the condition.
- The filter is used as-is: field names are the real document fields (`_id`, not `id`), and ids must be real `ObjectId` values.
- See the MongoDB guides on [query filters](https://www.mongodb.com/docs/manual/tutorial/query-documents/) and [query operators](https://www.mongodb.com/docs/manual/reference/operator/query/) for everything a filter can do.

Custom conditions combine with the other conditions using **And** / **Or**, just like any other row.

## Related blocks

- [DB Get All](./db-get-all.md), [DB Get Single](./db-get-single.md) and [DB Count](./db-count.md): read records.
- [DB Update](./db-update.md) and [DB Delete](./db-delete.md): change or remove records.
- [DB Joins](./db-joins.md): filter across related tables.
- [If Condition](./if-condition.md): the same idea for choosing a path instead of records.
