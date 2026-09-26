---
title: DB Get All
description: Retrieve multiple records from a database.
---

# DB Get All

The **DB Get All** block fetches a list of records from a table. You can filter, sort, limit, join related tables, and choose which columns come back.

## Inputs

- **Connection**: The database integration to use.
- **Table Name**: The table to query.
- **Conditions**: Rules to filter the data.
- **Joins**: Other tables to combine with this query (SQL databases only — see [Joins](#joins) below).
- **Columns**: Which columns to return (see [Columns](#columns) below). Leave empty to return every column.
- **Limit**: The maximum number of records to return.
- **Offset**: The number of records to skip (useful for pagination).
- **Sort**: Which column to sort by and the direction (ascending/descending).

## Logic

1.  The block queries the **Table Name**, combining in any **Joins**.
2.  It applies **Conditions**, **Sort**, **Limit**, and **Offset**.
3.  It returns the list of matching records, limited to the selected **Columns**, as the output.

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

## Filtering nested / JSON fields

If a column stores JSON data (for example a Postgres `jsonb` column or a MongoDB document field), you can filter and sort on the values inside it using plain JavaScript-style access:

- Use a dot to reach into a key: `attributes.age`
- Use brackets to reach into a list: `tags[0]`, `items[0].name`

Example: a condition on `attributes.age` with operator `>=` and value `18` returns only records where the `age` field inside `attributes` is 18 or higher. This works the same way whether the value is stored as a number or as a numeric-looking string.

The value side of a condition can also point at a field instead of a fixed value — for example, checking that `attributes.age` is greater than or equal to `attributes.minAge` compares two fields on the same record. This has to be marked explicitly as a field reference; otherwise the value is always compared as-is, so an ordinary value that happens to contain dots (an email address, a version number, a domain) is matched exactly and never mistaken for a field name.

::: info MongoDB
Comparing two fields against each other is only available on SQL databases.
:::

## Optional filters

A condition is **skipped** when its value is `undefined` when the block runs. This lets one block serve both "filter" and "don't filter" without any branching.

Example: a condition `status` `=` `js:getQueryParam('status')`.

| Request | What runs |
| --- | --- |
| `/users?status=active` | only records with `status = active` |
| `/users` | every record — the condition is left out |

`null` is **not** skipped: it is a real value, so a condition with a `null` value still filters.

::: warning Update and Delete
The same rule applies to **DB Update** and **DB Delete**. If every condition is skipped, the block updates or deletes **every record** in the table. Make sure at least one condition always has a value.
:::

## Custom conditions

When the [built-in operators](#operators) are not enough — JSON or array operators, regular expressions, full-text search — pick the **Custom** operator and write the condition yourself. The editor follows your connection's database.

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
- If any `{{ }}` value is `undefined`, the whole condition is skipped (see [Optional filters](#optional-filters)).
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

## Joins

Joins let you pull in data from a related table in the same query (available for SQL databases — this section is hidden when your connection is MongoDB).

Each join needs:

- **Table**: The other table to combine with.
- **Alias** *(optional)*: A short name to refer to that table by. Useful when joining the same table more than once, or to keep column references short.
- **Join Condition**: How the two tables are related, written as `leftColumn = rightColumn` (for example `books.author_id = authors.id`).
- **Type**: `inner`, `left`, `right`, or `outer`.

Once a join is added, you can refer to columns from either table by prefixing them with the table name or alias, both in **Conditions** and **Columns** — for example `authors.name` or, with an alias `a`, `a.name`.

## Columns

By default every column is returned. To narrow the result, list the columns you want:

- `name` — a plain column
- `books.title` — a column qualified by table (needed once you've added a join)
- `books.title AS bookTitle` — rename a column in the output
- `books.*` — every column from one table in a join

## Notes

- Sorting also supports JSON paths and table-qualified columns, using the same dot/bracket notation.
- For MongoDB connections, **Joins** are not available; **Columns** still works as a simple field selector.
