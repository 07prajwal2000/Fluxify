---
title: DB Get Single
description: Retrieve a single record from a database.
---

# DB Get Single

The **DB Get Single** block fetches exactly one record from a table. This is best used when you are looking up a specific item by its unique ID.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to query.
- **Conditions**: Rules to find the specific record. A condition whose value is `undefined` is skipped, and the **Custom** operator lets you write the condition yourself — see [Operators](/blocks/db-get-all#operators), [Groups](/blocks/db-get-all#groups-brackets), [Optional filters](/blocks/db-get-all#optional-filters) and [Custom conditions](/blocks/db-get-all#custom-conditions).
- **Joins**: Other tables to combine with this query (SQL databases only — see [Joins](#joins) below).
- **Columns**: Which columns to return (see [Columns](#columns) below). Leave empty to return every column.
- **Sort**: Which record to pick when several match — for example `created_at` Desc for the newest. Same list as [DB Get All's sort](/blocks/db-get-all#sort). With no sort, any matching record may come back.
- **Strict: exactly one match** (checkbox, off by default): fail the block when more than one record matches, instead of returning one of them. Turn it on for lookups that should be unique, like an id, email or token, so a duplicate shows up as an error rather than a silently wrong record. No match still returns nothing, as usual.

## Logic

1.  The block searches the **Table Name**, combining in any **Joins**.
2.  It sorts the records that match the **Conditions** by **Sort**, if set, and takes the first one.
3.  It returns that single record, limited to the selected **Columns**.

## Filtering nested / JSON fields

If a column stores JSON data (for example a Postgres `jsonb` column or a MongoDB document field), you can filter on the values inside it using plain JavaScript-style access:

- Use a dot to reach into a key: `attributes.age`
- Use brackets to reach into a list: `tags[0]`, `items[0].name`

Example: a condition on `attributes.age` with operator `>=` and value `18` matches a record where the `age` field inside `attributes` is 18 or higher. This works the same way whether the value is stored as a number or as a numeric-looking string.

The value side of a condition can also point at a field instead of a fixed value — for example, checking that `attributes.age` is greater than or equal to `attributes.minAge` compares two fields on the same record. This has to be marked explicitly as a field reference; otherwise the value is always compared as-is, so an ordinary value that happens to contain dots (an email address, a version number, a domain) is matched exactly and never mistaken for a field name.

::: info MongoDB
Comparing two fields against each other is only available on SQL databases.
:::

## Joins

Joins let you pull in data from a related table in the same lookup (PostgreSQL and MySQL; MongoDB has no joins yet).

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

- MongoDB has no joins yet: a graph with joins on a MongoDB connection cannot be saved. **Columns** still works as a simple field selector.
