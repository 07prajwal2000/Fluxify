---
title: Overrides
description: Run a test suite against a test database or with different settings, without changing the route.
---

# Overrides

A route usually talks to real things: your production database, a payment service, settings from [App Config](/concepts/app-config). **Overrides** let one suite swap those for test versions. The route itself doesn't change, and nothing outside the suite is affected.

Open the suite and choose the **Overrides** tab.

## App config overrides

Give an existing App Config key a different value **for this suite only**.

| Key | Test value |
| --- | --- |
| `PAYMENTS_API_URL` | `https://sandbox.payments.example.com` |
| `FEATURE_NEW_CHECKOUT` | `true` |

Press **Add**, pick the key, and type the test value.

::: tip Integrations follow along
If an integration's settings use an App Config key (for example a database address stored as `DB_URL`), overriding that key also changes the integration for this suite. That is often the simplest way to point a suite at a test database.
:::

## Integration overrides

Swap one integration for another **for this suite only**. Every block that uses the first one uses the replacement instead.

| Integration to replace | Replacement |
| --- | --- |
| `Main database` | `Test database` |

Press **Add**, pick the integration the route uses, then the one to use instead. Only integrations of this project can be picked. The replacement should be the same kind (a database for a database).

## What overrides apply to

Overrides apply to everything the suite runs:

- the route and its [hooks](./hooks);
- the suite's [setup and teardown](./setup-and-teardown) blocks.

So if you swap the main database for a test one, setup adds its data to the test database, the route reads it from there, and teardown removes it from there.

::: warning Overrides don't make a service safe
An override only changes where a block sends its request. If a suite has no override for a real service, the suite really calls it. Use an override, or a [hook](./hooks) that skips the block, for anything you don't want touched while testing.
:::
