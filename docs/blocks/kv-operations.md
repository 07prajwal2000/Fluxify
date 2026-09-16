---
title: KV Operations
description: Read, write, and delete keys in a Redis or Memcached store.
---

# KV Operations

The **KV Operations** block reads and writes single keys in a key-value store. Use it to cache an expensive result, keep a short-lived token, count something, or hold state between requests.

Pick the operation you want and the block shows only the fields that operation needs.

## Inputs

- **Connection**: The KV store integration to use — see [KV Stores](/integrations/kv-stores).
- **Operation**: `Get`, `Set`, or `Delete`.
- **Key**: The key to work with. Accepts a JS expression, so the key can depend on the request, for example `js:return "user:" + getRouteParam("id")`.

Depending on the operation, you also get:

| Operation | Extra fields |
| --- | --- |
| Get | **Parse JSON** |
| Set | **Use Param**, **Value**, **TTL (seconds)** |
| Delete | *none* |

## What each operation returns

| Operation | Output |
| --- | --- |
| Get | The stored value, or `null` when the key does not exist |
| Set | `true` |
| Delete | `true` |

## Get

By default a value comes back exactly as it was stored — as text.

Tick **Parse JSON** when the key holds a JSON object or array and you want to work with it as real data in later blocks, rather than a string.

```javascript
// stored value: {"id":7,"name":"ada"}
// Parse JSON off -> '{"id":7,"name":"ada"}'  (a string)
// Parse JSON on  -> { id: 7, name: "ada" }   (an object)
```

::: info A missing key stays null
If the key isn't there, the output is `null` whether or not **Parse JSON** is on. Nothing is parsed, so you can always check for `null` to mean "not cached yet".
:::

::: warning
With **Parse JSON** on, a value that is not valid JSON fails the block instead of quietly handing the next block a string. If a key might hold plain text, leave the option off and parse it yourself in a [JS Runner](/blocks/js-runner).
:::

## Set

**Value** is what gets stored. It accepts a JS expression, and anything that isn't text is stored as JSON automatically — so you can hand it an object without converting it first.

Tick **Use Param** to store the **previous block's output** instead of typing a value. This is the common shape for caching: fetch something, then cache exactly what you fetched.

**TTL (seconds)** sets how long the key lives. Leave it empty (or `0`) to store the key with no expiry.

| TTL | Meaning |
| --- | --- |
| *empty* or `0` | Keep the key until something deletes it |
| `60` | Expire the key after 60 seconds |

## Delete

Removes the key. Deleting a key that was never there is not an error — the output is still `true`.

## Example: cache an expensive lookup

A typical read-through cache needs three of these blocks:

1. **KV Operations** — `Get` the key `js:return "user:" + getRouteParam("id")`, with **Parse JSON** on.
2. **If Condition** — check whether that output is `null`.
   - Not `null`: the value was cached, go straight to your [Response](/blocks/response).
   - `null`: fetch the record with [DB Get Single](/blocks/db-get-single), then **KV Operations** again — `Set`, same key, **Use Param** ticked, **TTL** `300` — and respond.

## Notes

- Keys and values are text at the storage level. **Parse JSON** on the way out and automatic JSON encoding on the way in are conveniences around that.
- Both Redis and Memcached support everything on this block, so a workflow built against one still works if you point the connection at the other.
- For anything beyond get, set, and delete — counters, expiry on an existing key, hashes, lists — use the [KV Raw Connection](/blocks/kv-raw) block.
- Tick **Save output to variable** to keep the result under `outputs.<name>` for later blocks.
