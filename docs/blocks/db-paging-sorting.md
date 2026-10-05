---
title: DB Sorting and Paging
description: Order records and read them page by page with limit, offset or cursor paging.
---

# DB Sorting and Paging

How [DB Get All](./db-get-all.md) orders its records and splits a big result into pages.

## Sort

**Add sort** adds a row with a column and a direction (**Asc** / **Desc**, click to flip). The top row sorts first; each next row only orders rows that tie on the ones above it. Drag the grip, or use the arrows, to change the order.

| Sort list | Result |
| --- | --- |
| `team` Asc, `created_at` Desc | grouped by team; newest first inside each team |
| `created_at` Desc, `team` Asc | newest first; `team` only matters for rows created at the same moment |

- **Ties never shuffle.** The table's primary key (`_id` on MongoDB) is always added as the last sort, unless it is already in the list. Rows that tie on every column come back in key order every time, so paging with **Offset** never repeats or skips a row. With cursor paging, the [tiebreaker columns](/blocks/db-paging-sorting#cursor-paging) take its place.
- **No sort** means key order. On a table without a primary key (for example a view), the order is up to the database.
- A column can be a `js:` expression, e.g. `js:getQueryParam('sortBy')`. When it returns `undefined`, that row is **skipped**, so sorting can be optional, just like [optional filters](/blocks/db-conditions#optional-filters). A blank column is an error.
- MongoDB: `id` means `_id`, unless the documents have their own `id` field. See [MongoDB ids](/integrations/databases#ids).

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

## Related blocks

- [DB Get All](./db-get-all.md): the block that uses sorting and paging.
- [DB Conditions](./db-conditions.md): filter before you page.
