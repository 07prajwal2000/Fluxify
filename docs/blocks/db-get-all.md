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

## Filtering nested / JSON fields

If a column stores JSON data (for example a Postgres `jsonb` column or a MongoDB document field), you can filter and sort on the values inside it using plain JavaScript-style access:

- Use a dot to reach into a key: `attributes.age`
- Use brackets to reach into a list: `tags[0]`, `items[0].name`

Example: a condition on `attributes.age` with operator `>=` and value `18` returns only records where the `age` field inside `attributes` is 18 or higher. This works the same way whether the value is stored as a number or as a numeric-looking string.

The value side of a condition can also point at a field instead of a fixed value — for example, checking that `attributes.age` is greater than or equal to `attributes.minAge` compares two fields on the same record.

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
