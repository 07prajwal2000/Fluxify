---
title: Self-Signed Enterprise Licenses (pre-1.0)
description: Until Fluxify 1.0 there is no license issuer, so signed enterprise keys are minted against a keypair you generate yourself. How to mint one, how to point admin at it, how to test expiry and the grace period, and what changes at 1.0.
---

# Self-Signed Enterprise Licenses

::: danger This page is temporary
It describes how Fluxify works **before the 1.0 release**, while no license
issuer exists. From 1.0 onwards, enterprise keys are issued by Fluxify and the
issuer's public key is part of the build — nothing on this page applies, and
the environment variable it uses is ignored. See
[What changes at 1.0](#what-changes-at-1-0).
:::

An enterprise license key is a small signed token. Fluxify checks the signature
against **one** public key, and that key is baked into the build — it is
deliberately not something an operator can set, because a key you could point
at is a key anyone could sign their own license with.

No Fluxify issuer exists yet, so that baked key is empty and every signed key
is refused. To work on or test the enterprise paths before 1.0, you generate a
throwaway issuer keypair, sign your own keys with it, and tell your build to
verify against its public half.

## First — you probably don't need this {#do-you-need-it}

`LICENSE_KEY=NON_COMMERCIAL` already unlocks **every** enterprise feature, for
free, with no signing and no expiry. If all you want is the features on, use
that and stop here — see [Editions](/deployments/editions).

Sign your own key only for what `NON_COMMERCIAL` cannot express:

| You want to test | Why NON_COMMERCIAL can't |
| :--- | :--- |
| An expiry date, and the 30-day grace period after it | It never expires |
| A licensee name on the License page | It has no licensee |
| A key that unlocks only *some* features | It unlocks all of them |
| The "this key was refused, and why" paths | It is always accepted |

## Mint a key {#mint}

From the repository root:

```bash
bun run --cwd packages/common license:mint -- --licensee acme --days 365
```

It prints the key and writes three files into `.license/` at the repository
root, which is gitignored:

| File | What it is |
| :--- | :--- |
| `.license/issuer.key` | **Private key.** Signs license keys. Never commit it, never share it. |
| `.license/issuer.pub` | Public key. What a build verifies keys with. |
| `.license/test.license` | The key that was just minted, so you can copy it again later. |

The keypair is generated on the first run and reused after that, so keys you
minted earlier keep verifying. Delete `.license/` and every key minted before
it becomes worthless.

### Options

| Flag | Default | What it does |
| :--- | :--- | :--- |
| `--licensee` | *required* | The name shown on the License page. |
| `--days` | `365` | Days until expiry. `-1` mints a key that is **already expired**. `never` mints one with no expiry at all. |
| `--features` | `*` | Comma-separated feature list, e.g. `connectors`. `*` means everything. |

```bash
# a key that expired yesterday — for testing the grace period
bun run --cwd packages/common license:mint -- --licensee acme --days -1

# perpetual, connectors only
bun run --cwd packages/common license:mint -- --licensee acme --days never --features connectors
```

::: warning Do not commit the public key either
`.license/issuer.pub` is not the Fluxify issuer key. Committing it would make a
throwaway keypair look official, which is exactly the confusion the baked key
exists to prevent.
:::

## Point your build at it {#use-it}

Two settings, both on the **admin** process:

```bash
# .env
LICENSE_ISSUER_KEY_PATH=.license/issuer.pub   # verify keys with this key
LICENSE_KEY=eyJhbGciOiJFZERTQSIsInR...        # the key minted above
```

Restart admin. It logs two lines:

```
Verifying license keys against a local issuer key (.license/issuer.pub) — not a Fluxify-issued key
edition: enterprise (license active)
```

The first line is meant to be loud. A build verifying against a key you
generated must never be mistaken for a licensed one.

You can also leave `LICENSE_KEY` out of the environment and paste the key into
**Instance Settings → License** instead. It is checked the same way, so
`LICENSE_ISSUER_KEY_PATH` still has to be set for it to be accepted.

::: tip Workers and the orchestrator need neither variable
Only the admin ever sees a license key. It checks the key and tells every other
container which edition to run, so a worker never holds the key and can never
disagree with the admin about the edition.
:::

## In Docker {#docker}

The public key has to be a file **inside** the admin container, so mount it and
point the variable at the path it has in there:

```bash
docker run --rm -p 8080:8080 --env-file .env \
  -v "$PWD/.license/issuer.pub:/app/.license/issuer.pub:ro" \
  -e LICENSE_ISSUER_KEY_PATH=/app/.license/issuer.pub \
  ghcr.io/fluxify-rest/fluxify-admin:alpha
```

The same two lines in the compose file, on the `admin` service (or on `fluxify`
if you run the [Kit image](./kit)):

```yaml
services:
  admin:
    environment:
      LICENSE_ISSUER_KEY_PATH: /app/.license/issuer.pub
    volumes:
      - ../../.license/issuer.pub:/app/.license/issuer.pub:ro
```

If the path is wrong, the key is not silently ignored — admin logs
`LICENSE_ISSUER_KEY_PATH is set but unreadable, signed keys cannot verify` and
runs as Community.

## Testing expiry and the grace period {#expiry}

Mint an expired key (`--days -1`), restart admin, and this is what you should
see:

| | Expected |
| :--- | :--- |
| License page | Enterprise, **expired**, with the day the grace period ends |
| Dashboard | A banner counting the days left |
| Existing connectors | Still running |
| Creating a new connector | Refused, with "the license has expired" |
| After the 30-day grace period | Enterprise features stop; Community keeps working |

A key that is mistyped, truncated or edited is **refused, never fatal**:
Fluxify starts as Community, the License page shows the reason, and the admin
log records it. That is the intended behaviour — a license problem must never
take an instance down.

## What changes at 1.0 {#what-changes-at-1-0}

| | Pre-1.0 (today) | From 1.0 |
| :--- | :--- | :--- |
| Who issues enterprise keys | You do, with `license:mint` | Fluxify |
| The public key keys verify against | A file you generate, named by `LICENSE_ISSUER_KEY_PATH` | Baked into the build |
| `LICENSE_ISSUER_KEY_PATH` | Fills the empty key slot | **Ignored** |
| Keys minted with `license:mint` | Verify | Stop verifying — the instance runs as Community |
| `NON_COMMERCIAL` | Unlocks everything, free | Unchanged |

`LICENSE_ISSUER_KEY_PATH` can only ever *fill an empty* key slot — it cannot
replace a key that is already part of the build. So the day the real issuer key
ships, this path stops doing anything, and no setting can swap the key out.
That is the point: it is a hole for development, not a door.

If you were running a self-signed key, replace it with a real one (or
`NON_COMMERCIAL`) when you upgrade to 1.0.
