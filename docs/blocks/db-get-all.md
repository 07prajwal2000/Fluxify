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
- **Paging**: **Offset** (the default) or **Cursor** (see [Paging](#paging) below).
- **Limit**: The maximum number of records to return. `-1` means no limit.
- **Offset**: The number of records to skip. Offset paging only.
- **After**: Where the page starts. Cursor paging only.
- **Sort**: The order of the rows, as a list of columns (see [Sort](#sort) below).
- **Tiebreaker columns**: Cursor paging only (see [Cursor paging](#cursor-paging) below).

## Logic

1.  The block queries the **Table Name**, combining in any **Joins**.
2.  It applies **Conditions**, **Sort**, **Limit**, and **Offset** (or **After**).
3.  It returns the matching records, limited to the selected **Columns**, as the output: a list with offset paging, or `{ rows, nextCursor }` with cursor paging.

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
- [Optional filters](#optional-filters) work inside groups: a group whose conditions are all skipped is skipped too, and so is an empty group.

## Sort

**Add sort** adds a row with a column and a direction (**Asc** / **Desc**, click to flip). The top row sorts first; each next row only orders rows that tie on the ones above it. Drag the grip, or use the arrows, to change the order.

| Sort list | Result |
| --- | --- |
| `team` Asc, `created_at` Desc | grouped by team; newest first inside each team |
| `created_at` Desc, `team` Asc | newest first; `team` only matters for rows created at the same moment |

- **Ties never shuffle.** The table's primary key (`_id` on MongoDB) is always added as the last sort, unless it is already in the list. Rows that tie on every column come back in key order every time, so paging with **Offset** never repeats or skips a row. With cursor paging, the [tiebreaker columns](#cursor-paging) take its place.
- **No sort** means key order. On a table without a primary key (for example a view), the order is up to the database.
- A column can be a `js:` expression, e.g. `js:getQueryParam('sortBy')`. When it returns `undefined`, that row is **skipped**, so sorting can be optional, just like [optional filters](#optional-filters). A blank column is an error.
- MongoDB: `id` means `_id`.

## Paging

### Limit and Offset

| Limit | Result |
| --- | --- |
| left empty | up to 1000 records |
| a whole number, e.g. `50` or `5000` | up to that many records; there is no hidden maximum |
| `-1` | every matching record |

**Offset** is how many records to skip first; empty means `0`.

Both accept text holding a number, so `js:getQueryParam('limit')` works as is. Anything else, such as `abc`, `2.5`, `0` for Limit or `-5` for Offset, stops the block with an error that names the value, for example `limit must be a whole number ≥ 1, or -1 for no limit, got "abc"`.

::: warning No limit loads everything
`-1` loads every matching record at once. On a big table that can be slow and use a lot of memory. Use cursor paging to go through a big table page by page instead.
:::

### Cursor paging

Offset paging gets slow on deep pages, and when records are added or removed between two requests, the pages shift: you see a record twice, or miss one. Cursor paging has neither problem. Each page starts exactly after the last record of the one before.

Set **Paging** to **Cursor**. The block then returns:

```json
{
  "rows": [ { "id": 1, "name": "Ada" }, { "id": 2, "name": "Grace" } ],
  "nextCursor": "WzIsImdyYWNlIl0"
}
```

- For the first page, leave **After** empty.
- For the next page, pass `nextCursor` back as **After**, unchanged, e.g. **After** set to `js:getQueryParam('after')` and the client calling `/users?after=WzIsImdyYWNlIl0`.
- `nextCursor` is `null` on the last page.
- Keep the same **Sort** and **Tiebreaker columns** for every page. A cursor from a different sort, or text that is not a cursor, stops the block with an error.
- **Offset** is hidden and ignored.
- Records added behind the current page are not returned; records added ahead of it are.

**Tiebreaker columns.** Records are told apart by the **Sort** columns first, then by the tiebreaker columns, top to bottom. Together these must be unique, or records that tie on all of them can be skipped between pages. Use **Add tiebreaker** to pick a column from the list or type one; drag to reorder.

| Tiebreaker columns | Used |
| --- | --- |
| empty | the table's primary key (`_id` on MongoDB) |
| empty, on a table without a primary key (e.g. a view) | error: add them |
| `email` | `email`, e.g. for a view that has no key but unique emails |

**Empty values in a sort column.** A record whose sort column is empty (`null`, or a missing field on MongoDB) is still returned, exactly once. Where it lands depends on the database:

| Database | Ascending sort | Descending sort |
| --- | --- | --- |
| PostgreSQL | empty values last | empty values first |
| MySQL, MongoDB | empty values first | empty values last |

This is the same order the block uses without a cursor, so switching between offset and cursor paging never reorders records.

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
The same rule applies to **DB Update** and **DB Delete**. If every condition is skipped (including every condition inside groups), the block updates or deletes **every record** in the table. Make sure at least one condition always has a value.
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

Joins let you pull in data from a related table in the same query (PostgreSQL and MySQL; MongoDB has no joins yet).

Each join needs:

- **Table**: The other table to combine with.
- **Alias** *(optional)*: A short name to refer to that table by. Useful when joining the same table more than once, or to keep column references short.
- **On**: When a row of this table matches a row of the other. This is a list of conditions, built exactly like **Conditions**: the same operators, groups and custom conditions. A side can be a column of either table, or a fixed value.
- **Type**: which rows come back.

| Type | Rows returned | PostgreSQL | MySQL |
| --- | --- | --- | --- |
| **Inner** | Only rows that match on both sides | Yes | Yes |
| **Left** | Every row of this table; the other table's columns are empty when nothing matches | Yes | Yes |
| **Right** | Every row of the joined table; this table's columns are empty when nothing matches | Yes | Yes |
| **Full** | Every row of both tables, matched where they can be | Yes | No |

For example, to join each order to its rider, but only riders who are active:

| Column | Operator | Value |
| --- | --- | --- |
| `orders.rider_id` | equals | column `riders.id` |
| `riders.active` | equals | `true` |

::: info
MySQL has no full join, so a graph with one on a MySQL connection cannot be saved. Use a left or right join instead.
:::

::: tip
Like **Conditions**, an **On** condition whose value is `undefined` when the block runs is left out. If every condition of a join is left out, each row is paired with every row of the other table, so keep at least one column-to-column condition that always has a value.
:::

Joins saved before **On** existed, written as `books.author_id = authors.id`, keep working as a single condition. A join type saved as `outer` means **Full**.

Once a join is added, you can refer to columns from either table by prefixing them with the table name or alias, both in **Conditions** and **Columns** — for example `authors.name` or, with an alias `a`, `a.name`.

## Columns

By default every column is returned. To narrow the result, list the columns you want:

- `name` — a plain column
- `books.title` — a column qualified by table (needed once you've added a join)
- `books.title AS bookTitle` — rename a column in the output
- `books.*` — every column from one table in a join

## Notes

- Sorting also supports JSON paths and table-qualified columns, using the same dot/bracket notation.
- MongoDB has no joins yet: a graph with joins on a MongoDB connection cannot be saved. **Columns** still works as a simple field selector.
- Very large whole numbers and decimals come back as text, and dates as `Date` in UTC. See [Value types](/integrations/databases#value-types).
