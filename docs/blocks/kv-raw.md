---
title: KV Raw Connection
description: Run any command against a Redis or Memcached store using JavaScript.
---

# KV Raw Connection

The **KV Raw Connection** block gives your JavaScript direct access to the key-value store's own client. Use it for anything the [KV Operations](/blocks/kv-operations) block doesn't cover — counters, setting expiry on a key that already exists, hashes, lists, sets, or several commands in one go.

## Inputs

- **Connection**: The KV store integration to use — see [KV Stores](/integrations/kv-stores).
- **JS**: The JavaScript code to execute. Your code has access to a `kv` object, the client for the selected connection.

## Logic

1. The block runs your **JS** code with `kv` available.
2. You call whatever commands you need on `kv`.
3. Whatever your code returns becomes the block output.

`kv` exists only while your code runs, so you can't reach it from other blocks.

## Redis

The client exposes the standard Redis command set as methods, and each one returns a promise — so `await` them.

```javascript
// count an API hit and return the new total
const hits = await kv.incr("hits:" + getRouteParam("id"));
return hits; // 42
```

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

## Memcached

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

## Notes

- Always `await` your commands. Without it you return a pending promise instead of a value.
- If a command fails, the block fails, and the original error is kept as the cause so you can see what the store reported.
- Stick to [KV Operations](/blocks/kv-operations) for plain get, set, and delete — it works the same on both stores and needs no code.
- Tick **Save output to variable** to keep what you returned under `outputs.<name>` for later blocks.
