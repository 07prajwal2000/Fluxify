---
title: Retry
description: Run a chain of blocks again when it fails, with a wait between tries.
---

# Retry

The **Retry** block runs a chain of blocks and, if that chain fails with an error, runs it again. Use it for steps that sometimes fail for a moment and then work, like a call to a busy API.

## When to use it

- Call an external service that sometimes times out or returns an error.
- Read from something that may not be ready yet, and wait a little before trying again.
- Don't use it for errors that will never go away, like a wrong URL or bad input. Every try fails the same way.

::: warning Retrying a write can run it twice
Each try runs the whole chain again. If the chain inserts a record or sends a payment request and then fails on a later block, the next try does that write again. Keep writes idempotent (safe to repeat), or keep them out of the retried chain.
:::

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Executor** (top handle) | Yes | none | Connect the first block of the chain to retry. It gets the Retry block's input on every try. |
| **Retry type** (Delay tab) | No | Fixed delay | How long to wait before each new try. See [Retry types](/blocks/retry#retry-types). |
| **Max retries** | No | `3` | How many more times to try after the first one. From 1 to 10, so the chain runs at most 11 times. |
| **Delay (ms)** (Delay tab) | No | `1000` | The starting wait, from 0 to 30000. Not used by **Immediate**. |
| **Max delay (ms)** (Delay tab) | No | `30000` | The longest any single wait can be, from 0 to 30000. |
| **Save output to variable** | No | off | Store the result of a successful try in `outputs.<name>`. |

## Outputs

| Handle | Runs when | Input to the next block |
| --- | --- | --- |
| **Success** (right) | A try finished without an error. | The last output of the **Executor** chain. |
| **Failure** (right) | Every try failed. | `{ attempts, message }` |
| **Executor** (top) | On every try. | Connect the chain to retry. |

- `attempts` is how many times the chain ran, the first try included.
- `message` is the error text of the last try.

## Retry types

With a **Delay** of `1000`, the waits before each retry are:

| Retry type | What it does | Retry 1 | Retry 2 | Retry 3 |
| --- | --- | --- | --- | --- |
| **Immediate** | No wait. | 0 | 0 | 0 |
| **Fixed delay** | The same wait every time. | 1000 | 1000 | 1000 |
| **Linear backoff** | The wait grows by **Delay** each time. | 1000 | 2000 | 3000 |
| **Exponential backoff** | The wait doubles each time. | 1000 | 2000 | 4000 |
| **Exponential backoff + jitter** | A random wait between 0 and the exponential one. | 0 to 1000 | 0 to 2000 | 0 to 4000 |

No wait is ever longer than **Max delay**.

::: tip Which one to pick
Use **Exponential backoff + jitter** when many requests may fail at the same moment, for example when a shared service goes down. The random waits spread the retries out, so they don't all hit the service again at once.
:::

## Example: call a flaky API

```
Entrypoint → Retry (Exponential backoff + jitter, Max retries 3, Delay 500)
               ├─ executor → HTTP Request (GET https://api.example.com/rates)
               ├─ success  → Response 200   (input: the API's response)
               └─ failure  → Response 503   (input: { attempts: 4, message })
```

If the API fails, the block waits and calls it again, up to 3 more times. When it works, the caller gets the rates. When every try fails, the caller gets a `503`.

## How it behaves

1. The block runs the **Executor** chain.
2. If the chain finishes without an error, it continues on **Success**.
3. If a block in the chain throws an error, it waits (see **Retry type**) and runs the chain again.
4. When the chain has failed **Max retries** more times, it continues on **Failure**.

- If a block in the executor chain sends a **Response**, that response is returned right away. That is not an error, so nothing is retried.
- The wait does not hold up other requests. Only this run waits.
- Every failed try still shows in the logs and traces, so you can see why it failed.

### When nothing is connected to Failure

The last error fails the run, as with any other block, so the [Error Handler](./error-handler.md) still receives it.

### Inside a database transaction

A [Rollback Transaction](./db-rollback.md) block or a transaction timeout inside the executor chain is not retried. It stops the transaction as usual.

On PostgreSQL, a failed query breaks the whole transaction, so retrying inside one cannot recover. Put the **Retry** block around the [DB Transaction](./db-transaction.md) instead, so each try gets a fresh transaction.

## Related blocks

- [DB Transaction](./db-transaction.md): has its own **Retries** setting for deadlocks and conflicts.
- [HTTP Request](./http-request.md): the block you will retry most often.
- [Error Handler](./error-handler.md): receives the last error when **Failure** is not connected.
