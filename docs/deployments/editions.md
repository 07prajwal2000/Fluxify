---
title: Editions and Licensing
description: Which Fluxify features are free (Community) and which need an Enterprise license, how to set LICENSE_KEY, what NON_COMMERCIAL means, and exactly what happens when a license expires.
---

# Editions and Licensing

Fluxify comes in two editions. Both run from the same images; what you get is
decided by one setting, `LICENSE_KEY`.

## What is in each edition

| Feature | Community | Enterprise |
| :--- | :---: | :---: |
| Routes, blocks, the visual editor | ✅ | ✅ |
| Workflows | ✅ | ✅ |
| Schedules (cron, intervals, one-shot) | ✅ | ✅ |
| Batching | ✅ | ✅ |
| The Trigger Workflow block | ✅ | ✅ |
| External connectors — Kafka, SQS, SNS, Pub/Sub, Service Bus, external NATS | — | ✅ |

::: info Connectors are on the way
External connectors are not released yet. When they are, they will need the
Enterprise edition. Everything else on this page already works today.
:::

## Setting your license

Add `LICENSE_KEY` to the `.env` of your **admin** container (or the Kit
container), then restart it.

| `LICENSE_KEY` value | Edition you get |
| :--- | :--- |
| Not set | **Community** |
| `NON_COMMERCIAL` | **Enterprise**, for non-commercial use |
| A license key you were issued | **Enterprise**, until the key expires |

```bash
# .env
LICENSE_KEY=NON_COMMERCIAL
```

You do **not** need to set it on workers. They learn the edition from the admin
container automatically.

::: tip What is NON_COMMERCIAL?
`NON_COMMERCIAL` turns on every Enterprise feature at no cost for personal,
education, and non-profit use. The example `.env` files ship with it already
set. Remove the line to run the Community edition, which is free for any use,
including commercial. See [Licenses and Contributions](/deployments/licensing)
for exactly who qualifies.
:::

::: warning A key that doesn't work never stops Fluxify
If `LICENSE_KEY` holds something that is not a valid key — a typo, a key cut
off when it was pasted, or an edited key — Fluxify still starts. It runs as
**Community** and writes an error to its log saying the key was rejected.
:::

## Checking which edition is running

When the admin container starts, its log includes one line like this:

```
edition: enterprise (license active)
```

Workers write the same line when they start.

## What happens when a license expires

An expired license does not take anything down straight away. You have a
**30-day grace period** to renew.

| | Before expiry | Expired, within 30 days | After the 30 days |
| :--- | :---: | :---: | :---: |
| Existing connectors keep running | ✅ | ✅ | ❌ |
| You can create new connectors | ✅ | ❌ | ❌ |
| Community features | ✅ | ✅ | ✅ |

- **The moment the license expires,** you can no longer create new connectors.
  Trying to create one returns an error that says the license has expired.
- **During the grace period,** the dashboard shows a banner with the number of
  days left, so you find out before anything stops.
- **After the grace period,** Enterprise features stop until the license is
  renewed. Everything in the Community edition keeps working.

To renew, replace `LICENSE_KEY` with your new key and restart the admin
container.

## Turning connectors off

Even with a license, you can switch external connectors off for the whole
instance. Set the instance setting `featureflags.ee.connectors` to
`{ "enabled": false }` through the instance settings API. The change reaches
every worker within seconds — no restart needed. Set it back to `true` (or
delete it) to turn connectors on again.
