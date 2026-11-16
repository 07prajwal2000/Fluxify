---
title: Scheduled Backups
description: Automatically upload encrypted project backups to an S3-compatible object storage bucket on a daily, weekly or monthly schedule.
---

# Scheduled Backups

::: info Enterprise and Non-commercial Feature
Scheduled backups to object storage are available in the **Enterprise** and **Non-commercial** editions. On the Community edition, backup settings and history remain visible, but scheduled backups do not run. See [Editions and Licensing](/deployments/editions).
:::

Scheduled backups automatically upload encrypted backups of your project directly to an S3-compatible cloud storage bucket. If hardware fails or an entire instance is lost, your backups remain safe in your own cloud account and can be restored immediately on any fresh instance.

## Before you start

Before enabling scheduled backups, create an **Object Storage** integration in your project. Fluxify supports Amazon S3, Cloudflare R2, MinIO, Google Cloud Storage, and other S3-compatible storage providers.

For configuration details and setup examples, see [Object Storage Integrations](/integrations/object-storage).

## Set it up

To configure automatic backups:

1. Open **Project Settings → Backup**.
2. Open the **Schedule** tab.
3. Configure the backup parameters:
   - **Integration**: Select the Object Storage integration whose bucket will receive the backups.
   - **Prefix**: The folder path inside the bucket where backups will be stored.
     - Allowed characters: letters, numbers, dots (`.`), underscores (`_`), and hyphens (`-`), organized in path segments separated by forward slashes (`/`), with no leading or trailing slashes (for example, `backups/production-app`).
     - Defaults to your project's slug.
     - Always use a unique prefix that no other project shares.
   - **How often**: Choose how frequently backups should run:
     - `Daily`
     - `Weekly`
     - `Monthly`
   - **Backups to keep**: The maximum number of complete backups to retain in the bucket (between 1 and 1000; defaults to 7).
   - **Back up on a schedule**: Check this box to enable automatic recurring backups.
4. Click **Save**.

Scheduled backups use the parts of the project selected under **What to include** on the **Back up** tab, and include any text written in the **README** field. Scheduled backups are always created as full, encrypted backups — never unencrypted templates.

## When backups run

Fluxify checks scheduled backups once every day:

- **Daily**: Runs once each day during the daily platform check.
- **Weekly**: Runs on the first daily check at least 7 days after the last successful backup.
- **Monthly**: Runs on the first daily check after a full calendar month has elapsed since the last successful backup.

If a scheduled backup fails (for example, if the storage bucket is temporarily unreachable), Fluxify retries the backup automatically during the next daily check.

## Back up now

The **Back up now** button, in the bar at the top of the Backup page next to **Download backup**, uploads an encrypted backup to your bucket immediately. It does not wait for the next scheduled interval. This is useful when you are about to deploy significant changes or want an immediate snapshot saved off-site. The button appears once you have saved an integration and a prefix on the **Schedule** tab.

## What is in the bucket

Each backup creates two files with matching names directly under your chosen prefix:

- `<prefix>/<timestamp>-<backupId>.tar.gz`: The encrypted backup archive containing your selected project resources.
- `<prefix>/<timestamp>-<backupId>.meta.json`: A small unencrypted summary file containing metadata such as the project name, slug, creation timestamp, Fluxify release, and the list of included resources.

The summary file contains no secrets, credentials, or README text. Fluxify reads this lightweight summary file to list backups quickly without downloading full archives. Any backup archive that lacks a matching summary file is considered incomplete and is ignored.

Only the specified project prefix is used. Fluxify never inspects or touches files stored outside this folder.

## How many are kept

Fluxify automatically manages retention based on your **Backups to keep** setting:

- It preserves the newest *N* complete backup pairs in the bucket.
- Whenever a new scheduled or manual backup completes successfully, older complete backups beyond the limit are deleted automatically.
- Only backups located directly within this project's prefix folder are deleted.

## Failures

If an upload fails — due to invalid credentials, network timeouts, or an unapproved plugin — the failure is recorded in the project's **History** tab along with the error description.

The **Schedule** tab also displays an alert showing when the last run failed and the error message reported by the storage service.

## Licensing and grace periods

- **Active Enterprise or Non-commercial license**: Backups run on schedule, "Back up now" works, and backup settings can be modified.
- **During the 30-day Enterprise license grace period**: Scheduled backups continue running automatically and "Back up now" remains active, but changing and saving backup settings is disabled.
- **Community edition**: Backup settings and history remain visible in read-only mode, but scheduled runs and the "Back up now" button do not run.

## Restored projects

When you restore a project from a backup:

- Scheduled backups in the newly created project are automatically **switched off**.
- The **Prefix** field is reset to empty.

This prevents the restored project from writing into or pruning backups from the original project's bucket folder. To enable scheduled backups on the restored project, specify a new unique folder prefix and enable the schedule.
