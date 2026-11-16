---
title: Object Storage Integrations
description: Connect an S3-compatible bucket (Amazon S3, Cloudflare R2, MinIO or Google Cloud Storage) so Fluxify can keep files such as project backups outside the server.
---

# Object Storage Integrations

An object storage integration connects Fluxify to one bucket. Project backups
can be saved to it, so a copy of your project lives somewhere other than the
Fluxify server.

## Used for

- [Scheduled Backups](/concepts/backup-schedules): Automatically upload recurring project backups to your bucket on a daily, weekly, or monthly schedule.
- [Restore and Roll Back](/concepts/restore): Restore or roll back a project directly from backups stored in your bucket.

The **S3 Compatible** provider works with any service that speaks the Amazon S3
API:

| Service | Endpoint | Region | Path-style URLs |
|---|---|---|---|
| Amazon S3 | leave empty | the bucket's region, e.g. `eu-west-1` | off |
| Cloudflare R2 | `https://<account id>.r2.cloudflarestorage.com` | `auto` | off |
| MinIO and other self-hosted servers | `http://minio.internal:9000` | `us-east-1` | **on** |
| Google Cloud Storage | `https://storage.googleapis.com` | `auto` | off |

For Google Cloud Storage, create an **HMAC key** in the bucket's interoperability
settings and use it as the access key ID and secret.

## Settings

| Setting | Required | Default | What it is |
|---|---|---|---|
| **Bucket** | Yes | | The bucket's name. Create it first: Fluxify does not create buckets. |
| **Endpoint** | No | Amazon S3 | The service's address, starting with `http://` or `https://`. |
| **Region** | No | `us-east-1` | The bucket's region. |
| **Access key ID** | Yes | | The key Fluxify signs in with. |
| **Secret access key** | Yes | | The key's secret. |
| **Use path-style URLs** | No | off | Puts the bucket in the path (`endpoint/bucket/file`) instead of the host name (`bucket.endpoint/file`). Most self-hosted servers need it. |

::: tip Keep the secret in App Config
Store the secret access key as an encrypted [App Config](/concepts/app-config)
value and pick it with a `cfg:` key, so it never sits in the integration itself.
:::

The keys need permission to **list**, **read**, **write** and **delete** objects
in the bucket. Give them access to that bucket only.

## Setup examples

### Amazon S3

- **Endpoint**: *(leave empty)*
- **Region**: `us-east-1` (or your bucket's region, e.g. `eu-west-1`)
- **Bucket**: `my-fluxify-backups`
- **Access key ID**: `AKIAIOSFODNN7EXAMPLE`
- **Secret access key**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
- **Use path-style URLs**: `off`

### Cloudflare R2

- **Endpoint**: `https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com`
- **Region**: `auto`
- **Bucket**: `my-fluxify-backups`
- **Access key ID**: `1a2b3c4d5e6f7a8b9c0dEXAMPLE`
- **Secret access key**: `9876543210fedcba9876543210fedcbaEXAMPLE`
- **Use path-style URLs**: `off`

### MinIO and self-hosted S3

- **Endpoint**: `http://minio.internal:9000` (or `https://s3.example.com`)
- **Region**: `us-east-1`
- **Bucket**: `fluxify-backups`
- **Access key ID**: `minioadmin`
- **Secret access key**: `minioadmin`
- **Use path-style URLs**: **on**

### Google Cloud Storage

Create an **HMAC key** in the Google Cloud console under Cloud Storage → Settings → Interoperability.

- **Endpoint**: `https://storage.googleapis.com`
- **Region**: `auto`
- **Bucket**: `my-fluxify-backups`
- **Access key ID**: `GOOG1EEXAMPLEACCESSKEY`
- **Secret access key**: `GOOG1ESECRETKEYEXAMPLE12345`
- **Use path-style URLs**: `off`

## Test connection

**Test connection** lists one file in the bucket. It tells you which part is wrong:

| Message | What to fix |
|---|---|
| The access key ID or secret access key was refused | One of the keys is wrong, or has expired. |
| The keys were accepted but are not allowed to use bucket "…" | The keys work, but have no permission on this bucket. |
| Bucket "…" does not exist | The bucket name is wrong, or the bucket is in another account. |
| Bucket "…" is in a different region | Set the region the bucket was created in. |
| Could not reach … | The endpoint is wrong, or the server cannot reach it. |

## How it behaves

- Large files are uploaded in 5 MB parts, so there is no practical size limit.
- Saving a file with the same name as an existing one replaces it.
