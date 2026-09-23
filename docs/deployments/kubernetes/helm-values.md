---
title: Chart settings
description: Every setting of Fluxify's Helm chart, what it does and its default, with example values files for common setups.
---

# Chart settings

Fluxify's Helm chart is configured with a values file, `fluxify-values.yaml`,
passed to every `helm install` and `helm upgrade` with `-f`. This page lists
every setting it can hold. [Install on Kubernetes](./install) shows where the
file is used.

A values file only needs the settings you change. Anything left out keeps its
default.

> [!TIP]
> To see the chart's full settings file, with a note on every line, for the
> release you run:
>
> ```bash
> helm show values oci://ghcr.io/fluxify-rest/charts/fluxify --version %%CHART_VERSION%%
> ```

## Address {#address}

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `url` | The address people open Fluxify at, e.g. `https://fluxify.example.com`. Sign-in only works at this address. | `http://localhost:8080` |

## Database {#database}

Set exactly one of these three.

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `postgres.urlFrom.secret` | The name of a Secret, in Fluxify's namespace, that holds the database address. CloudNativePG makes one named `<database>-app`. | — |
| `postgres.urlFrom.key` | The key inside that Secret. | `uri` |
| `secret.values.PG_URL` | The database address itself: `postgres://USER:PASSWORD@HOST:5432/DATABASE`. | — |
| `postgres.bundled` | Run one Postgres pod inside the chart. No copies, no backups: for trying Fluxify only. | `false` |
| `postgres.storage` | Disk size for that built-in Postgres. | `5Gi` |
| `postgres.image` | The image for that built-in Postgres. | `postgres:17-alpine` |

## Keys and passwords {#secret}

All of Fluxify's keys and passwords live in one Secret, `fluxify-env`. By
default the chart creates it and generates every value you leave empty. A
generated value is kept across upgrades, and the Secret is kept even after
`helm uninstall`.

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `secret.create` | `false` to create `fluxify-env` yourself, e.g. from a secret manager. See [below](#own-secret). | `true` |
| `secret.values.MASTER_ENCRYPTION_KEY` | Locks the passwords and keys stored in Fluxify. Must be `openssl rand -base64 32`. Never change it once set. | generated |
| `secret.values.BETTER_AUTH_SECRET` | Signs sign-in sessions. | generated |
| `secret.values.SYSTEM_ACCESS_KEY` | A key that lets scripts and other systems call Fluxify's API without a user. | generated |
| `secret.values.NATS_TOKEN` | NATS's password. Must start with a letter: NATS reads one like `5e3…` as a number and does not start. | generated |
| `secret.values.REDIS_PASS` | Valkey's password. | generated |
| `secret.values.SEED_USER_PASSWORD` | The first account's password, used on an empty database only. | generated |
| `secret.values.PG_PASSWORD` | The built-in Postgres's password. | generated |
| `secret.values.PG_URL` | See [Database](#database). | — |

> [!WARNING]
> A values file with passwords in it is a secret itself. Do not commit it to
> git with them in. Leave them out to have them generated, or use
> [your own Secret](#own-secret).

## Fluxify's own settings {#env}

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `env` | Any other Fluxify setting, by its name in `env.example`. | — |
| `admin.seedUserEmail` | The first account's email, used on an empty database only. | `admin@company.com` |

For example:

```yaml
env:
  ENABLE_AI: "true"
  # Add workers sooner: at 50% CPU instead of 65%.
  ORCHESTRATOR_SCALE_CPU_PERCENT: "50"
  OTLP_LOGS_ENDPOINT: https://logs.example.com/v1/logs
```

Values under `env` must be text, so quote numbers and `true`/`false`.

## Resources {#resources}

How much CPU and memory Fluxify's own pods ask for. Workers are sized per claim
in the portal instead: see [Sizing a worker](./#sizing).

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `admin.resources` | The portal and API. Test runs execute here, so it has a memory ceiling. | 250m CPU, 512Mi, at most 2Gi |
| `orchestrator.resources` | The orchestrator. | 100m CPU, 128Mi, at most 500m CPU and 512Mi |

```yaml
admin:
  resources:
    requests: { cpu: "1", memory: 1Gi }
    limits: { memory: 4Gi }
```

## Web traffic {#traffic}

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `ingressRoute.enabled` | Send `/_/admin` (the portal and API) to Fluxify through Traefik. `false` to expose it your own way; the service is `fluxify-admin`, port `8080`. | `true` |
| `ingressRoute.entryPoint` | The Traefik entry point it listens on. | `web` |

## NATS {#nats}

NATS is installed with Fluxify from the
[official NATS chart](https://github.com/nats-io/k8s/tree/main/helm/charts/nats):
three servers, so losing one loses nothing. Any setting of that chart goes
under `nats:`.

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `nats.enabled` | `false` to use a NATS you already run. | `true` |
| `nats.config.cluster.replicas` | How many NATS servers. At least 3 for production. | `3` |
| `nats.config.jetstream.fileStore.pvc.size` | Disk per NATS server. | `10Gi` |
| `external.natsUrl` | Your NATS, when `nats.enabled` is `false`, e.g. `nats://nats.messaging.svc:4222`. It must have JetStream on. Its token goes in `secret.values.NATS_TOKEN`. | — |
| `external.natsMonitoringEndpoint` | Your NATS's monitoring address, `host:8222`, so workflow claims scale on waiting runs. | — |

## Valkey {#valkey}

Valkey is installed with Fluxify from the
[official Valkey chart](https://github.com/valkey-io/valkey-helm). Fluxify only
keeps a cache in it, so one server is enough. Any setting of that chart goes
under `valkey:`.

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `valkey.enabled` | `false` to use a Valkey or Redis you already run. | `true` |
| `valkey.replica.enabled` | Keep copies on other machines, for faster recovery. Also set `valkey.replica.persistence.size`, e.g. `1Gi`. | `false` |
| `external.redisHost` | Your Valkey or Redis, when `valkey.enabled` is `false`. Its password goes in `secret.values.REDIS_PASS`. | — |
| `external.redisPort` | Its port. | `6379` |
| `external.redisUser` | Its user, if it has users. | — |

## Images and license {#images}

| Setting | What it does | Default |
| :--- | :--- | :--- |
| `image.tag` | Run another release's images than the chart's own. Best left alone. | the chart's release |
| `image.registry` | Where the images come from, for a mirror. | `ghcr.io/fluxify-rest` |
| `image.pullPolicy` | When the cluster pulls images again. | `IfNotPresent` |
| `license.issuerKeySecret` | A Secret holding `issuer.pub`, for a [self-signed license](../self-signed-license). Before 1.0 only. | — |

## Example files {#examples}

### Production with CloudNativePG

[Install on Kubernetes](./install) step 6's production file, with more room for
the portal and API once many people use it:

```yaml
url: https://fluxify.example.com

postgres:
  urlFrom:
    secret: fluxify-db-app

admin:
  resources:
    requests: { cpu: "1", memory: 1Gi }
    limits: { memory: 4Gi }
```

### Your own NATS and Valkey

```yaml
url: https://fluxify.example.com

postgres:
  urlFrom:
    secret: fluxify-db-app

nats:
  enabled: false
valkey:
  enabled: false

external:
  natsUrl: nats://nats.messaging.svc:4222
  natsMonitoringEndpoint: nats.messaging.svc:8222
  redisHost: valkey.cache.svc
```

Put their passwords in the Secret as `NATS_TOKEN` and `REDIS_PASS`: with
`--set-string secret.values.NATS_TOKEN=...` on the command line, or in
[your own Secret](#own-secret).

### Keys from your own Secret {#own-secret}

With a secret manager (External Secrets, Sealed Secrets, Vault), create a
Secret named `fluxify-env` in Fluxify's namespace before installing, and turn
off the chart's:

```yaml
secret:
  create: false
```

It must hold these keys:

| Key | How to make it |
| :--- | :--- |
| `MASTER_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `SYSTEM_ACCESS_KEY` | `openssl rand -hex 32` |
| `NATS_TOKEN` | `n$(openssl rand -hex 31)`. It must start with a letter. |
| `REDIS_PASS` | `openssl rand -hex 32` |
| `SEED_USER_PASSWORD` | A password you choose |
| `PG_URL` | Your database address, unless you use `postgres.urlFrom` |
| `PG_PASSWORD` | `openssl rand -hex 32`, only with `postgres.bundled` |

### Trial on a laptop

```yaml
url: http://localhost:8080

postgres:
  bundled: true

# One NATS server is enough to try things.
nats:
  config:
    cluster:
      enabled: false
```
