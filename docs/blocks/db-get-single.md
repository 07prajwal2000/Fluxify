---
title: DB Get Single
description: Retrieve a single record from a database.
---

# DB Get Single

The **DB Get Single** block fetches exactly one record from a table. This is best used when you are looking up a specific item by its unique ID.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to query.
- **Conditions**: Rules to find the specific record.
- **Joins**: Other tables to combine with this query (SQL databases only — see [Joins](#joins) below).
- **Columns**: Which columns to return (see [Columns](#columns) below). Leave empty to return every column.

## Logic

1.  The block searches the **Table Name**, combining in any **Joins**.
2.  It finds the first record that matches the **Conditions**.
3.  It returns that single record, limited to the selected **Columns**.

## Filtering nested / JSON fields

If a column stores JSON data (for example a Postgres `jsonb` column or a MongoDB document field), you can filter on the values inside it using plain JavaScript-style access:

- Use a dot to reach into a key: `attributes.age`
- Use brackets to reach into a list: `tags[0]`, `items[0].name`

Example: a condition on `attributes.age` with operator `>=` and value `18` matches a record where the `age` field inside `attributes` is 18 or higher. This works the same way whether the value is stored as a number or as a numeric-looking string.

The value side of a condition can also point at a field instead of a fixed value — for example, checking that `attributes.age` is greater than or equal to `attributes.minAge` compares two fields on the same record.

## Joins

Joins let you pull in data from a related table in the same lookup (available for SQL databases — this section is hidden when your connection is MongoDB).

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

- For MongoDB connections, **Joins** are not available; **Columns** still works as a simple field selector.
