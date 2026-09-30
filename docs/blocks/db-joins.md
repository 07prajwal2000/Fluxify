---
title: DB Joins
description: Combine records from related tables in one query, with inner, left, right and full joins.
---

# DB Joins

Joins pull in data from a related table in the same query. They are available in [DB Get All](./db-get-all.md), [DB Get Single](./db-get-single.md), [DB Row Exists](./db-row-exists.md) and [DB Count](./db-count.md), on PostgreSQL and MySQL.

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

## Related blocks

- [DB Get All](./db-get-all.md) and [DB Get Single](./db-get-single.md): the blocks that use joins.
- [DB Conditions](./db-conditions.md): the **On** list is built like **Conditions**.
