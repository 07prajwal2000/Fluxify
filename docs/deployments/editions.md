---
title: Editions and Licensing
description: Which Fluxify features are free (Community) and which need an Enterprise license, how to pick your edition from the admin UI or LICENSE_KEY, what non-commercial means, and exactly what happens when a license expires.
---

# Editions and Licensing

Fluxify comes in two editions. Both run from the same images; what you get is
decided by the edition you pick — in the admin UI, or with the `LICENSE_KEY`
setting.

## What is in each edition

| Feature | Community | Enterprise |
| :--- | :---: | :---: |
| Routes, blocks, the visual editor | ✅ | ✅ |
| Workflows | ✅ | ✅ |
| Schedules (cron, intervals, one-shot) | ✅ | ✅ |
| Batching | ✅ | ✅ |
| The Trigger Workflow block | ✅ | ✅ |
| External connectors — Kafka today; SQS, SNS, Pub/Sub, Service Bus and external NATS on the way | — | ✅ |

A license key says which Enterprise features it includes. Most include all of
them; the **License** page shows exactly what yours unlocks.

## Picking your edition

System admins manage the edition under **Instance Settings → License**. The
page shows the edition that is running, whether it is active or expired, and
which features it unlocks. There are three choices:

| Edition | What you do | What you get |
| :--- | :--- | :--- |
| **Community** | Pick it | Free for any use, including commercial. No external connectors. |
| **Non-commercial** | Pick it and confirm your use is personal, education, or non-profit | Every Enterprise feature, at no cost |
| **Enterprise** | Paste the license key you were issued | The features your key includes, until it expires |

The change takes effect on the admin and every worker within a few seconds.
Nothing needs to restart.

A new Fluxify instance runs the **non-commercial** edition until you pick
another one. See [Licenses and Contributions](/deployments/licensing) for
exactly who qualifies for non-commercial use.

When you paste a license key, Fluxify checks it before saving it. A key that is
mistyped, cut off, edited, or already expired is refused with the reason, and
the edition you had stays as it was.

::: info Your key stays private
Once saved, a license key is stored encrypted and is never shown again — not
in the UI, not in any API response, not in the logs. The page shows only a
short **fingerprint**, so you can tell which key is active without seeing it.
:::

## Setting the license with `LICENSE_KEY` instead

You can also set the license in the `.env` of your **admin** container (or the
Kit container). It then takes priority over the UI.

| `LICENSE_KEY` value | Edition you get |
| :--- | :--- |
| Not set | Whatever is picked in the UI |
| `NON_COMMERCIAL` | **Enterprise**, for non-commercial use |
| A license key you were issued | **Enterprise**, until the key expires |

```bash
# .env
LICENSE_KEY=NON_COMMERCIAL
```

While `LICENSE_KEY` is set, the License page is **read-only** and says the
license is managed by the environment. To manage it from the UI again, remove
the line and restart the admin container. Changing `LICENSE_KEY` always needs a
restart; changes made in the UI never do.

You do **not** need to set it on workers. They learn the edition from the admin
container automatically.

::: warning A key that doesn't work never stops Fluxify
If `LICENSE_KEY` holds something that is not a valid key — a typo, a key cut
off when it was pasted, or an edited key — Fluxify still starts. It runs as
**Community**, the License page shows the key as invalid with the reason, and
the admin log records the error.
:::

## Checking which edition is running

Open **Instance Settings → License**. The admin log also includes one line
like this when it starts, and whenever the edition changes:

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

To renew, paste your new key on the License page. If you use `LICENSE_KEY`,
replace it with the new key and restart the admin container.

## Turning connectors off

Even with a license, you can switch external connectors off for the whole
instance. Set the instance setting `featureflags.ee.connectors` to
`{ "enabled": false }` through the instance settings API. The change reaches
every worker within seconds — no restart needed. The License page shows
connectors as switched off while it is set. Set it back to `true` (or delete
it) to turn connectors on again.
