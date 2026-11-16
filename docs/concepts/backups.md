---
title: Project Backups
description: Save a whole project to a backup file or to your own bucket, choose what goes in it, and keep a history of every backup.
---

# Project Backups

A backup saves an entire project — including routes, workflows, triggers, blocks, integrations, settings, and dependencies — into a single archive file. You can restore a backup to create a brand new project, move work to another instance, or roll an existing project back to an earlier working state.

Fluxify provides two ways to back up a project: manual downloads you trigger yourself, and automatic scheduled uploads to cloud storage.

## Two ways to back up

| | Download a backup | Scheduled backups to object storage |
|---|---|---|
| **Edition** | Every edition (including Community) | Enterprise and Non-commercial |
| **When** | Whenever you click **Download backup** | Daily, weekly, or monthly schedules, plus **Back up now** |
| **Where it goes** | Downloaded to your computer (and kept on the server for 7 days for re-download) | Your own S3-compatible cloud storage bucket |

For details on setting up automated backups to your own bucket, see [Scheduled Backups](/concepts/backup-schedules).

## What is in a backup

When creating a backup, you can choose which parts of the project to include. Each item corresponds to a section of your project:

| Part | Default | Description |
|---|---|---|
| **App config** | On | The setting names. Values only come with the option below. |
| **Integrations** | On | Connections to databases, queues and other services. |
| **Project settings** | On | Subdomain, AI agent, telemetry and limits. |
| **npm packages** | On | The packages your code blocks use. |
| **Plugins** | On | Installed plugins, with their files. |
| **Custom blocks** | On | Your own blocks and their versions. |
| **Middlewares** | On | Block chains that run before or after routes. |
| **Routes** | On | Canvas, schemas, tests and whether each is live. |
| **Workflows** | On | Canvas, tests and whether each is live. |
| **Triggers** | On | Schedules and queue triggers, with their groups. |
| **Knowledge sources** | On | Documents the AI agent searches. |

Two additional options can be toggled:

- **Canvas version history** (Off by default): Includes every committed version of each route, workflow, custom block, and middleware, not just the current live version. This produces a larger backup file.
- **App config values** (Off by default): Includes the actual encrypted secret values of your app configuration keys, rather than just the key names.

### What is never backed up

To keep backups portable and secure, runtime data and instance-wide configurations are never included in project backups:

- Sandboxes and sandbox triggers
- System logs and execution logs
- Execution recordings and trace runs
- Users, teams, and access control permissions
- Worker claims and orchestrator node claims
- Developer access tokens
- AI agent chat conversations

## Backup or template

Fluxify supports two kinds of project archives: **Backup** and **Template**.

| Feature | Backup | Template |
|---|---|---|
| **Purpose** | Disaster recovery, project migration, or rolling back | Starter projects, examples, or reusable foundations |
| **Encryption** | Encrypted with `MASTER_ENCRYPTION_KEY` | Plain archive (not encrypted) |
| **Secrets & credentials** | Included and encrypted | Stripped out (left empty) |
| **App config values** | Optional (encrypted if selected) | Never included (only key names are saved) |
| **Plugin approvals** | Approvals and permissions preserved | Reset to `pending` (requires approval upon restore) |
| **Knowledge sources** | All uploaded documents and web pages preserved | Uploaded documents dropped; web sources refetched on restore |
| **Production switches** | Preserved as they were when backed up | Switched off in production |
| **Target audience** | Your own team on instances sharing the master key | Anyone creating a new project on any instance |

For more details on building starter projects for others, see [Project Templates](/concepts/project-templates).

## Make a backup

To create a backup manually:

1. Open **Project Settings → Backup**. The **Back up** tab opens first.
2. Select the archive kind: **Backup** or **Template**.
3. Under **What to include**, select the checkboxes for the parts you want to save.
4. (Optional) Check **Canvas version history** or **App config values**.
5. (Optional) Click **Add a README** and write setup notes or instructions in Markdown.
6. Click **Download backup** at the top of the page.

Fluxify starts creating the backup archive in the background. Once finished, your browser automatically begins downloading the `.tar.gz` archive. The archive also remains available for 7 days in the **History** tab on the same page.

## When some parts are left out

If you untick a part that other selected parts depend on, a warning hint appears under the unticked checkbox:

- **App config left out**: Integrations and knowledge sources can refer to app config keys; without them those come in empty.
- **Integrations left out**: Routes use integrations; without them their connections come in empty.
- **Plugins left out**: Without plugins, plugin blocks and plugin triggers are left off.
- **Custom blocks left out**: A route, workflow or middleware that calls a custom block can't be restored without it.
- **Middlewares left out**: A route that uses a middleware can't be restored without it.
- **Workflows left out**: A trigger runs a workflow; one whose workflow isn't in the backup can't be restored.

You can still create the backup with missing dependencies, but restoring it will leave dependent connections empty or prevent dependent resources from running until configured.

## Backup history

The bar at the top of the Backup page always shows your most recent backup, with its result and how long ago it ran. Click the time to open the **History** tab, which lists recent backups created for the project:

- **Status**: Whether the backup succeeded, is currently running, or failed.
- **Size**: Compressed archive size on disk.
- **Type**: Manual backup or Object storage.
- **Mode**: Backup or Template.
- **Who & When**: The user who started the backup and the timestamp.
- **Release**: The Fluxify release version that generated the backup.

If a backup fails, the row displays the exact failure reason. Finished manual backup archives are kept on the server for 7 days, after which the download link expires while the record in history remains.

The Backup tab and its history are available to project creators, project admins and system admins. Viewers don't see it.

## Encryption

::: danger MASTER_ENCRYPTION_KEY required to restore
Encrypted backups can only be restored on a Fluxify instance that uses the exact same `MASTER_ENCRYPTION_KEY`.

Keep your `MASTER_ENCRYPTION_KEY` backed up securely in a password manager or secret manager outside the server. If this key is lost, changed, or differs between instances, encrypted backups cannot be decrypted, opened, or restored.

Templates are not encrypted and can be restored on any instance regardless of its master encryption key.
:::

## Older backups and newer Fluxify releases

::: info Backups across Fluxify releases
Backups made with older releases of Fluxify can be restored on newer releases.

If a backup is too old for the current release to restore directly, Fluxify refuses the file and names the release you need to restore it on first. In that situation, restore the archive on that older release, take a fresh backup from it, and restore the new backup on your current instance.

Backups created by a newer release of Fluxify cannot be restored on an older instance. Update your Fluxify installation to restore them.
:::

## Common errors

| Message you see | What to do |
|---|---|
| "Plugin \<name\> couldn't be read for the backup: ... Approve the changed version again (Settings → Plugins), check that FLUXIFY_PLUGINS_DIR is mounted on the admin, or untick Plugins for this backup." | If using folder plugins, approve the changed version in Settings → Plugins, verify the plugins directory is mounted, or untick Plugins before backing up. |
| "This backup unpacks to more than 512 MB; that is the limit." | The uncompressed size exceeds the 512 MB safety cap. Untick canvas version history or large knowledge sources to reduce size. |
| "This backup can't be decrypted. It was made on an instance with a different MASTER_ENCRYPTION_KEY, or it is damaged. Restore it on an instance with the key it was made with." | Verify that the target instance has the exact same `MASTER_ENCRYPTION_KEY` environment variable as the instance where the backup was made. |
| "This backup was made by a newer version of Fluxify. Update Fluxify to restore it." | The backup was created with a newer release of Fluxify. Update your Fluxify instance to the latest release before restoring. |
| "The README is longer than 64 KB." | Shorten your README note on the **Back up** tab to under 64 KB. |
| "A backup is already running" | Wait for the active backup to finish before starting another one. |
