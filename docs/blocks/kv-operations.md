---
title: KV Operations
description: Read, write or delete a single key in a key-value store like Redis or Memcached.
---

# KV Operations

The **KV Operations** block reads, writes or deletes one key in a key-value store. Use it to cache an expensive result, keep a short-lived token, or hold a small piece of state between requests.

Pick the operation you want and the block shows only the fields that operation needs.

## When to use it

- Cache a slow result, like a database query or an API answer, so the next request is fast.
- Keep something that must expire on its own, like a one-time code or a rate-limit flag.
- Hold a small piece of state that has to outlive a single request. Request [variables](./set-var.md) disappear when the request ends.
- Don't use it as your main database. Keys can expire or be evicted.
- Don't use it for counters, hashes or lists. Use [KV Raw Connection](./kv-raw.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The KV store integration to use, see [KV Stores](/integrations/kv-stores). |
| **Operation** | Yes | none | `Get`, `Set` or `Delete`. |
| **Key** | Yes | none | The key to work with. Can be a JS expression, for example `js:return "user:" + getRouteParam("id")`. |
| **Parse JSON** (`Get`) | No | off | Turn the stored text into an object or list. |
| **Use Param** (`Set`) | No | off | Store the previous block's output instead of **Value**. |
| **Value** (`Set`) | For `Set`, unless **Use Param** is on | none | What to store. A JS expression is allowed. Anything that isn't text is stored as JSON. |
| **TTL (seconds)** (`Set`) | No | none (no expiry) | How long the key lives. Empty or `0` keeps it until something deletes it. |
| **Keep KV result with input** | No | off | Pass on both the data the block received and the KV result, see [Outputs](/blocks/kv-operations#outputs). |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The operation worked. The next block receives the result below. |

| Operation | **Keep KV result with input** off (default) | **Keep KV result with input** on |
| --- | --- | --- |
| Get | The stored value, or `null` when the key does not exist. | `{ "input": <data the block received>, "result": <stored value or null> }` |
| Set | The data the block received, unchanged. | `{ "input": <data the block received>, "result": true }` |
| Delete | The data the block received, unchanged. | `{ "input": <data the block received>, "result": true }` |

::: tip Writes don't get in the way
A **Set** or **Delete** that fails stops the block, so reaching the next block already means it worked. That is why the block passes your data along instead of a `true`. For example, a create-user route can **Set** a key and then respond with `input.id`.
:::

::: warning Changed behaviour
Before this option, **Set** and **Delete** sent `true` to the next block. They now send the data they received. If a block after one of them still expects `true`, turn on **Keep KV result with input** and read `input.result`.
:::

## Example: cache an expensive lookup

A read-through cache needs three blocks:

1. **KV Operations**: `Get` the key `js:return "user:" + getRouteParam("id")`, with **Parse JSON** on.
2. **If Condition**: check whether that output is `null`.
   - Not `null`: the value was cached. Go straight to your [Response](./response.md).
   - `null`: fetch the record with [DB Get Single](./db-get-single.md), then **KV Operations** again: `Set`, the same key, **Use Param** on, **TTL** `300`. Then respond.

For the next five minutes, repeated requests are answered from the cache.

## How it behaves

### Get

By default a value comes back exactly as it was stored, as text.

Turn on **Parse JSON** when the key holds a JSON object or list and you want real data in later blocks, rather than a string.

```javascript
// stored value: {"id":7,"name":"ada"}
// Parse JSON off -> '{"id":7,"name":"ada"}'  (a string)
// Parse JSON on  -> { id: 7, name: "ada" }   (an object)
```

::: info A missing key stays null
If the key isn't there, the output is `null` whether or not **Parse JSON** is on. Nothing is parsed, so you can always check for `null` to mean "not cached yet".
:::

::: warning
With **Parse JSON** on, a value that is not valid JSON fails the block instead of quietly handing the next block a string. If a key might hold plain text, leave the option off and parse it yourself in a [JS Runner](./js-runner.md).
:::

### Set

**Value** is what gets stored. It accepts a JS expression, and anything that isn't text is stored as JSON automatically, so you can hand it an object without converting it first.

Turn on **Use Param** to store the **previous block's output** instead of typing a value. This is the common shape for caching: fetch something, then cache exactly what you fetched.

| TTL | Meaning |
| --- | --- |
| *empty* or `0` | Keep the key until something deletes it |
| `60` | Expire the key after 60 seconds |

### Delete

Removes the key. Deleting a key that was never there is not an error, and the block still passes your data along (or `result: true` when **Keep KV result with input** is on).

### In general

- Keys and values are text at the storage level. **Parse JSON** on the way out and automatic JSON encoding on the way in are conveniences around that.
- Both Redis and Memcached support everything on this block, so a workflow built against one still works if you point the connection at the other.
- A store that can't be reached fails the block, and the [Error Handler](./error-handler.md) runs.
- **Get replaces the flowing data** with the stored value. **Set** and **Delete** leave it as it was. Turn on **Keep KV result with input** to receive both, or use **Save output to variable** to keep the result in a variable.

## Related blocks

- [KV Raw Connection](./kv-raw.md): counters, expiry on an existing key, hashes, lists.
- [If Condition](./if-condition.md): check for a cache miss.
- [DB Get Single](./db-get-single.md): the slow lookup you cache.
- [Set Variable](./set-var.md): keep data for the current request only.
