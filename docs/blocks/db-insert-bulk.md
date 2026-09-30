---
title: DB Insert Bulk
description: Add a list of records to a table in one operation.
---

# DB Insert Bulk

The **DB Insert Bulk** block adds a whole list of records to a table in one operation, which is much faster than adding them one by one. It passes the inserted records on.

## When to use it

- Import a list, like rows from an uploaded file or an API answer.
- Save every line of an order together.
- Don't use it for a single record. [DB Insert](./db-insert.md) is simpler.
- Don't loop over a list with [DB Insert](./db-insert.md) inside a [For Each Loop](./foreach-loop.md). That sends one query per record.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The database integration to use. |
| **Table Name** | Yes | none | The table (or collection) to add to. |
| **Data** | Yes, unless **Use Param** is on | none | A list of objects to insert. |
| **Use Param** | No | off | On: insert the list that the previous block passed on, instead of **Data**. |
| **Run Inside a Transaction** | No | on for new blocks | On: all records are saved or none are. |
| **On conflict** | No | off | Update or skip records whose unique value already exists, instead of failing. |
| **Save output to variable** | No | off | Store the inserted records in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The insert worked. The next block receives the list of inserted records. |

## Example

Import two products from the previous block's list.

| Field | Value |
| --- | --- |
| Connection | `main-db` |
| Table Name | `products` |
| Use Param | on |

The previous block output `[{ "sku": "a1", "price": 5 }, { "sku": "b2", "price": 9 }]`. The next block receives both records with their new ids:

```json
[{ "id": 1, "sku": "a1", "price": 5 }, { "id": 2, "sku": "b2", "price": 9 }]
```

## How it behaves

- **Saved in batches.** A large list is inserted in several batches behind the scenes.
- **A failed insert is an error.** A duplicate value in a unique column, for example, fails the block and the [Error Handler](./error-handler.md) runs.
- **It replaces the flowing data** with the inserted records.

### All or nothing

Large lists are saved in several batches. With **Run Inside a Transaction** checked, if any batch fails (for example, a duplicate email), none of the records are kept, so you can safely retry.

With it unchecked, batches saved before the failure stay in the table, and the block still fails.

::: info
Inside a **DB Transaction** block, the bulk insert always joins that transaction, whether or not the box is checked.
:::

::: tip MongoDB
MongoDB supports transactions only on a replica set. On a standalone server, the records are inserted without a transaction, as if the box were unchecked.
:::

### On conflict (insert or update)

Works like [DB Insert's On conflict](./db-insert.md#on-conflict-insert-or-update), for every record in the list:

- **Update it**: existing records are updated, new ones are added. The block returns all of them.
- **Skip it**: existing records are left alone and left out of the result, so the result holds only the records that were added.

::: warning
- **PostgreSQL**: two records with the same **Match on** value in one list make the whole insert fail ("cannot affect row a second time"). MySQL and MongoDB apply them in order, so the last one wins.
- **MySQL**: **Skip it** reads the existing values first, one extra query per batch.
:::

## Related blocks

- [DB Insert](./db-insert.md): add a single record.
- [DB Transaction](./db-transaction.md): group this with other writes.
- [Transformer](./transformer.md): reshape your list to match the table columns first.
- [HTTP Request](./http-request.md): fetch the list from another service.
