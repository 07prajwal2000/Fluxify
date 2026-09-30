---
title: KV Raw Connection
description: Run any command against the key-value store with your own JavaScript.
---

# KV Raw Connection

The **KV Raw Connection** block gives your JavaScript direct access to the key-value store's own client. Use it for anything [KV Operations](./kv-operations.md) doesn't cover: counters, setting an expiry on a key that already exists, hashes, lists, sets, or several commands in one go.

## When to use it

- Count things, like API hits or page views, with `incr`.
- Put an expiry on a key that already exists, or read several keys in one round trip.
- Use Redis-only features like hashes, lists and sets.
- Don't use it for plain get, set and delete. [KV Operations](./kv-operations.md) works the same on both stores and needs no code.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The KV store integration to use, see [KV Stores](/integrations/kv-stores). |
| **JS** | Yes | none | The code to run. It has a `kv` object, the client for the selected connection, and must `return` the result. |
| **Save output to variable** | No | off | Store what you returned in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The code finished. The next block receives whatever your code returns. |

`kv` exists only while your code runs, so you can't reach it from other blocks.

## Example

Count a hit on a page and pass the new total on (Redis):

```javascript
const hits = await kv.incr("hits:" + getRouteParam("id"));
return hits; // 42
```

The next block receives `42` as its `input`.

## How it behaves

- **Always `await` your commands.** Without it you return a pending promise instead of a value.
- **Errors fail the block.** If a command fails, the block fails and the [Error Handler](./error-handler.md) runs. The original error is kept as the cause, so you can see what the store reported.
- **No safety net.** Commands run exactly as written, so be careful with commands that delete data.
- **It replaces the flowing data** with what you return.

### Redis

The client exposes the standard Redis command set as methods, and each one returns a promise, so `await` them.

```javascript
// put an expiry on a key that already exists
await kv.expire("session:" + getHeader("x-session"), 900);
return true;
```

```javascript
// read several keys in one round trip
const [name, email] = await kv.mget("user:7:name", "user:7:email");
return { name, email };
```

::: tip
Values come back as text. Use `JSON.parse()` if you stored an object, and remember a missing key reads as `null`.
:::

### Memcached

The Memcached client works differently: its methods take a **callback** instead of returning a promise. Wrap the call so you can `await` it.

```javascript
// add an expiry to an existing key
const ok = await new Promise((resolve, reject) => {
  kv.touch("session:abc", 900, (err) => (err ? reject(err) : resolve(true)));
});
return ok;
```

```javascript
// fetch many keys at once
const values = await new Promise((resolve, reject) => {
  kv.getMulti(["a", "b", "c"], (err, data) => (err ? reject(err) : resolve(data)));
});
return values; // { a: "1", b: "2", c: "3" }
```

::: warning Different stores, different commands
Redis and Memcached do not offer the same commands. Memcached has no hashes, lists, or sets, and no way to read a key's remaining time to live. Code written against one store will not run unchanged against the other, so if you swap the connection, re-check the commands you used.
:::

## Related blocks

- [KV Operations](./kv-operations.md): plain get, set and delete without code.
- [JS Runner](./js-runner.md): JavaScript without store access.
- [DB Native](./db-native.md): the same idea for SQL and MongoDB.
