---
title: KV Stores
description: Integrate Key-Value (KV) stores like Redis and Memcached into Fluxify workflows.
---

# Key-Value (KV) Stores

Fluxify allows you to seamlessly integrate external Key-Value (KV) stores to cache data, store transient state, manage sessions, and drastically improve the overall performance of your API workflows.

## Supported Variants

- **Redis**: Connect to any standard Redis instance.
- **Memcached**: Connect to any Memcached instance.

### Redis Integration

The Redis integration uses the robust `ioredis` driver under the hood. It supports both credentials-based parameters and connection string (URL) configurations.

::: tip Compatibility Note
Because this integration relies on the standard Redis communication protocol, it is fully compatible with any **Redis-compatible server**. This includes, but is not limited to:
- **[Valkey](https://valkey.io/)**
- **[DragonflyDB](https://dragonflydb.io/)**
- **KeyDB**
- **AWS ElastiCache for Redis / MemoryDB**
- **Upstash Serverless Redis**

If your caching infrastructure supports the standard Redis API, you can confidently connect it using the Redis variant.
:::

### Memcached Integration

The Memcached integration enables connection to standard Memcached nodes for blazing-fast in-memory object caching. Similar to the Redis variant, it supports providing individual connection parameters (host, port) or a full connection string URL.

## Configuration Options

When creating a new KV Store integration in the Fluxify UI dashboard, you can configure the connection via two modes:

1. **Via URL**:
   Provide the full connection string containing all authentication details.
   - *Example Redis URL*: `redis://username:password@redis.company.com:6379`
   - *Example Memcached URL*: `memcached://username:password@memcached.company.com:11211`

2. **Credentials**:
   Specify individual connection parameters dynamically:
   - **Host**: The domain or IP of the KV server (e.g., `redis.company.com` or `127.0.0.1`).
   - **Port**: The listening port (e.g., `6379` for Redis, `11211` for Memcached).
   - **Username**: Optional username for authentication (often `default` or empty in simple setups).
   - **Password**: Optional password/secret for authentication.

## Using a KV Store in a Workflow

Once the integration is saved, two blocks can use it. Both take the connection as their first setting, so the same store is reachable from any route or workflow in the project.

| Block | Use it for |
| --- | --- |
| [**KV Operations**](/blocks/kv-operations) | Getting, setting, and deleting a key, with optional expiry. Works identically on Redis and Memcached. |
| [**KV Raw Connection**](/blocks/kv-raw) | Anything else the store can do — counters, expiry on an existing key, hashes, lists — written as JavaScript against the store's own client. |

The most common use is a read-through cache: try **KV Operations** `Get` first, and on `null` do the real work and `Set` the result with a TTL. There is a worked example on the [KV Operations](/blocks/kv-operations#example-cache-an-expensive-lookup) page.

::: info Reused connections
A connection is opened once and reused across requests, so a cache read does not pay for a new connection each time. Updating the integration's credentials swaps the connection over automatically — no redeploy needed.
:::

## Security & App Config Variables

Like other external connections in Fluxify, you can securely pass dynamic credentials to your KV Store using **App Configs** instead of hardcoding raw strings. 

To reference an App Config, simply prefix your variable name with `cfg:` in the input fields. For example:
- **Host**: `cfg:REDIS_HOST`
- **Password**: `cfg:REDIS_SECRET`
- **URL**: `cfg:MEMCACHED_URL`

When the integration is loaded, Fluxify will securely resolve these variables at runtime, ensuring your production credentials remain safe and environment-specific.

## Testing Connections

Fluxify allows you to test your KV connection directly from the dashboard before saving. The test connection routine has a strict **5-second timeout**. If your host or port is incorrectly configured, or if the server is unreachable, the test will fail gracefully and surface the error to the UI, allowing you to debug your connection settings easily.
