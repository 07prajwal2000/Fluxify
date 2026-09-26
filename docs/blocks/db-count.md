---
title: DB Count
description: Count the records that match your conditions.
---

# DB Count

The **DB Count** block counts the records in a table that match your conditions and outputs that number. Use it for "how many active orders does this rider have?" or to show a total next to a paginated list, without loading every row.

## Inputs

The inputs are the same as [DB Get Single](/blocks/db-get-single#inputs), without **Columns**: **Connection**, **Table Name**, **Conditions** and **Joins**.

## Output

A number, for example `3`. When nothing matches, the output is `0`.

## Notes

- With no conditions, the block counts every record in the table.
- With joins, each joined row counts once. A user with two orders counts twice when you join `orders`.
- **MongoDB ignores joins.** Only the main collection is counted.
- On MongoDB, a collection that doesn't exist counts as `0`. On PostgreSQL and MySQL, a missing table is an error.
- A database error (bad connection, missing table or column) goes to the route's [Error Handler](/blocks/error-handler).
