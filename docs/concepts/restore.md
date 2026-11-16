---
title: Restore and Roll Back
description: Create a new project from a backup or template file, restore from object storage, or roll back an existing project in place.
---

# Restore and Roll Back

Fluxify gives you three ways to restore your work:

1. **Create a new project from a file**: Upload a backup or template file from your computer to create a new project.
2. **Create a new project from cloud storage**: Select a backup from your own S3-compatible bucket to create a new project.
3. **Roll back an existing project in place**: Restore an existing project directly to an earlier state, keeping its project identity, history, and links intact.

## Create a project from a file

You can create a new project using a `.tar.gz` backup or template file:

1. On the **Projects** page, click the arrow on the **New Project** button.
2. Select **From backup or template file**.
3. Choose the backup file from your computer.
4. A preview dialog opens with:
   - **Overview**: Shows the original project's name and slug, the Fluxify release that created it, the creation date, whether it is encrypted, and any warnings.
   - **README**: If the author included a README note, this tab displays instructions and setup details.
   - **Resource browser**: Browse custom blocks, middlewares, routes, workflows, triggers, integrations, and knowledge sources in a read-only viewer. Nothing is changed or created yet.
   - **New project form**: Enter the **Project name** (required, 2 to 50 characters), **Slug**, an optional **Subdomain**, and a **Description**.
5. Click **Create project**.

Fluxify creates the project, restores the selected resources, and queues background compilation.

### Limits and permissions

- **Permissions**: Restoring a project creates a new project on the instance and requires **System Administrator** privileges.
- **Upload size limit**: Browser uploads are capped at **100 MB** (and cannot unpack to more than **512 MB**). For larger archives, use an Object Storage integration.

## Warnings you may see

Before you confirm a restore, the overview tab highlights potential warnings. None of these warnings prevent the project from being created:

| Warning | What it means | What to do |
|---|---|---|
| "Group \<name\> has N triggers; this instance allows ... per group (MAX_TRIGGERS_PER_GROUP)..." | The backup contains more triggers in a group than this instance's configured limit. | All triggers are restored and remain active. You cannot add new triggers to this group until total triggers drop below the limit. |
| "Trigger \<name\> could not be activated. Open it and save it once." | The trigger was saved, but its schedule could not be activated automatically. | Open the trigger in the editor and click Save once to reactivate it. |
| "Route \<name\> uses integrations this backup doesn't restore: ... They are left blank..." | The backup omitted integrations or came from a template. | Block connections are left blank. Open the route canvas, select your integration on each connection, and save. |
| "Plugin \<name\> needs approving before routes that use its blocks will compile." | The backup was imported as a template, or the approver is unknown here. | Open **Project Settings → Plugins**, review permissions, and approve the plugin. |
| "Plugin \<name\> ... SDK range this instance doesn't satisfy" | The plugin requires a newer version of the Fluxify engine. | The restore is refused before anything is written. Update your Fluxify instance to restore this backup. |
| "Knowledge source \<name\> has no documents; upload them to use it." | Markdown knowledge sources in templates do not carry document files. | Upload your Markdown documents in the Knowledge Sources tab. |
| "Knowledge source \<name\> could not be indexed. Open it and press Refetch." | An online web documentation source could not be fetched during restore (for example, missing API headers). | Fill in any missing App Config keys, open the knowledge source, and click **Refetch**. |
| "The subdomain \<name\> is already used by another project here, so the restored project has none." | Another project on this instance already uses that subdomain. | Choose an available subdomain under **Project Settings → General**. |
| "When restoring a backup on the same instance, MCP OAuth connections may need re-authenticating." | Restoring next to the original project clones OAuth tokens. If the service rotates refresh tokens, using one project can invalidate the other. | Sign into the MCP server again in the restored project if needed. |
| "Compilation could not be queued; open the project and save any route to retry." | Automatic background compilation could not be triggered immediately. | Open any route in the project canvas and save it once to trigger compilation. |
| "Scheduled backups are off in the restored project; choose a prefix and turn them on." | To prevent overwriting the original project's backups, scheduled backups start disabled. | Specify a new unique folder prefix under **Project Settings → Backup** and turn scheduled backups on. |

## After restoring: checklist

After creating a restored project, complete these setup steps before directing production traffic to it:

1. **Fill in integration credentials**: If restoring from a template or a backup made without credentials, open **Integrations** and enter your passwords, keys, and tokens.
2. **Set App Config values**: If restoring a template, open **App Config** and provide values for keys required by your routes and blocks.
3. **Approve plugins**: If restoring a template, visit **Project Settings → Plugins** to review requested permissions and approve installed plugins.
4. **Check trigger groups**: Triggers assigned to non-default groups only execute when a worker claim explicitly targets that group. See [Workers per edition](/deployments/editions#workers).
5. **Re-activate production**: Workflows, routes, and triggers imported from a template start switched off in production. Turn them on when ready.
6. **Save any deactivated queue triggers**: If a queue trigger reported an activation warning, open it and click Save once.

## Restore from object storage

If your backups are stored in an S3-compatible cloud bucket, you can restore them directly without uploading files through your browser:

1. Open **Project Settings → Backup**.
2. Scroll to the **Remote backups** section.
3. Select your **Integration** and folder **Prefix**.
4. The table displays all complete backups in the folder, showing the creation date, source project name and slug, release, compressed size, and included resources.
5. Click **Restore** on the backup row you want.
6. Review the preview dialog, enter project details, and click **Create project**.

The maximum archive size supported for remote download and unpack is **512 MB**.

Restoring creates a brand new project and requires **System Administrator** permission. Non-admin users see the Restore button disabled.

## Disaster recovery on a fresh instance

If your original server is lost or destroyed, you can recover projects completely on a new server using your backup bucket:

1. Install and start a new Fluxify instance configured with the **same `MASTER_ENCRYPTION_KEY`** used by the original instance.
2. Sign in as a System Administrator and create an empty project.
3. In that project, navigate to **Integrations** and add an **Object Storage** integration pointing to the bucket that holds your backups.
4. Go to **Project Settings → Backup → Remote backups**.
5. Select the Object Storage integration and the prefix folder of your lost project.
6. Click **Restore** on the latest backup row.
7. Confirm the project name and subdomain (if the subdomain is not in use on this new instance, it will be assigned to your restored project).
8. Click **Create project**.
9. Once the restore finishes, delete the temporary empty project you created in step 2.

## Roll back a project in place

Instead of creating a separate new project, you can roll back your current project directly in place. This updates resources to match an earlier backup without changing the project's identity, URLs, or history.

### Where to start a rollback

You can start an in-place rollback from two places in **Project Settings → Backup**:

- Click **Upload a backup to roll back** to upload an archive file.
- Click **Roll back** on any row in the **Remote backups** list.

Rolling back in place requires **Creator** or **Admin** role on the project (unlike creating a new project, it does not require system administrator privileges).

### Keep extras vs. Exact replica

When rolling back, choose how to handle resources added to the project since the backup was taken:

| Mode | What happens to resources in the backup | What happens to resources added since |
|---|---|---|
| **Keep extras** | Resources in the backup are updated or re-created | Resources created since the backup was taken are kept |
| **Exact replica** | Resources in the backup are updated or re-created | Resources created since the backup are removed from the project (in ticked sections) |

For example, suppose the backup contained routes `x` and `y`, and your project currently has routes `y` and `z`:

| Mode | Route `x` (in backup only) | Route `y` (in both) | Route `z` (added since) |
|---|---|---|---|
| **Keep extras** | Created | Rolled back to backup state | Kept as is |
| **Exact replica** | Created | Rolled back to backup state | **Removed** |

Removals under Exact replica only apply to the sections you select to restore.

### Matching and ID preservation

Resources are matched by **name**, section by section. When a resource already exists in the project, it updates in place and retains its internal ID. This ensures existing execution logs, run histories, and external links remain valid.

### Safety net: automatic pre-rollback backup

::: tip Automatic pre-rollback backup
Before any rollback changes are applied, Fluxify automatically takes a full backup of the current project (recorded as **Before rollback** in your backup history).

If this safety backup cannot be created, the rollback is aborted and nothing in your project is touched. To undo a rollback, simply roll back to the "Before rollback" backup.
:::

### Credentials and App Config values

By default, existing integration credentials and App Config values are kept as they are today. Missing keys and integrations from the backup are added.

To overwrite today's credentials and values with those from the backup archive, check **Also restore credentials and values from the backup**. (This checkbox is disabled for templates, which do not contain secrets).

### How versions are handled

Routes, workflows, custom blocks, and middlewares receive two new committed versions in their history:

- A version reflecting the backup's production state (`Rolled back: production (vN, title)`).
- A version reflecting the backup's working copy (`Rolled back: working copy`). If both were identical, a single version is created.

Production begins serving the restored version immediately, and the full revision history is preserved.

### What rollback never changes

A rollback never alters or removes:

- Project name, slug, and description
- Subdomain
- Audit logging configuration
- Scheduled backup settings
- npm dependencies (unless the backup specifically contains package dependencies)

### Why a rollback can be refused

Fluxify checks the proposed changes and refuses the rollback before anything changes in these situations:

1. **Exact replica removes a dependency**: An extra resource that would be removed is required by a resource being kept (for example, keeping a route that calls a custom block that would be deleted). To fix this, include that section in the rollback or switch to **Keep extras**.
2. **Keep extras path collision**: A restored route would serve the exact same HTTP path and method as an extra route that is being kept. To fix this, rename or delete the extra route, or choose **Exact replica**.

### Rollback warnings

The preview dialog shows warnings for potential side effects:

- An App Config key will be removed by an exact replica rollback, but a kept resource may still read it.
- Removing an integration leaves an installed plugin without an integration of that kind.

::: warning Review dynamic keys and plugin code
The dependency checker scans stored resource configurations for App Config keys, but cannot inspect compiled plugin code or keys constructed dynamically at runtime (such as `get("API_" + env)`). Review custom scripts and plugins before confirming an exact replica rollback.
:::

## Roll back by restoring a copy

If you prefer to test an older backup before replacing your live project, use the restore-as-copy approach:

1. Restore the backup as a new project with a temporary name.
2. Test and verify all routes and workflows in the new project.
3. Open the original project in **Project Settings → General** and clear its subdomain.
4. Open the new project in **Project Settings → General** and assign the original subdomain to it.
5. Delete the old project once traffic has transitioned.
