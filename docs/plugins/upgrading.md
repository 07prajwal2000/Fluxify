---
title: Upgrading and Removing Plugins
description: How to upgrade a plugin safely with the upgrade preview, what blocks an upgrade and how to fix it, how to cancel one, and when removal is blocked.
---

# Upgrading and removing

## Upgrading

To upgrade, add the new version the same way you added the first ([ways to add one](./installing)): upload the new `.tgz`, or give npm the new exact version. The plugin keeps its name; a different name is a different plugin.

The plugin then shows **Upgrade pending**. Until a creator approves it:

- the **old version keeps serving** in development and production
- nothing in your routes changes

Open the plugin and press **Review upgrade**. The dialog shows an **upgrade preview** comparing the old and new versions:

| Section | Meaning |
| :--- | :--- |
| **Removed blocks / params / handles** | Things that existed before and are gone. Each lists where it is used, with links |
| **Changed invoke modes** | A block that can no longer run a way it used to, or now can run another way |
| **Changed shape or handles** | A block that looks or connects differently |
| **New permissions** | Anything the new version asks for on top of what you granted |
| **New blocks** | Blocks that are new in this version |
| **Deprecations** | Things the author marked as going away. **In use** means one of your routes uses it now |

### What blocks an upgrade

An upgrade is **blocked** when it removes something your project uses: a block, a setting, a connection point, or a way of running that a block in a route, workflow or custom block depends on. Both the working copy and the promoted production version count.

When it is blocked, **Approve** is disabled and the preview lists each use. To fix it:

1. Open each listed route, workflow or custom block (the links go straight to it).
2. Remove the block or setting that the new version no longer has, or rewire it.
3. Save and, for production, promote the change.
4. Return to the plugin and approve.

Or press **Cancel upgrade** and keep the old version.

::: info
Dev and Prod move together on an upgrade. Approving it replaces the old version in every environment where the plugin is enabled.
:::

### Cancel an upgrade

On a plugin with an upgrade pending, **Cancel upgrade** drops the pending version. The approved version keeps serving in development and production, and nothing else changes. To try again, add the new version again.

### Workers restart briefly

When an upgrade is approved, the workers that run the plugin switch to the new version by restarting their execution process. This takes a moment, and workers wait a few seconds at random so they don't all restart at once. If the new version fails to install on a worker, that worker keeps serving the old one. See [status](./status).

## Deprecations

Authors can mark a block, setting or connection point as **deprecated** with a message. You see:

- a **Deprecated** badge on the block in the picker and on the canvas (hover for the message)
- a banner in the block's settings, and the message beside a deprecated setting

It still works. The author is telling you to move off it, usually before a later version removes it.

## Removing a plugin

On the plugin's page, press **Remove**. Removal deletes the plugin from the project, its stored files, and any link requests.

Removal is **blocked while anything uses it**: a route, workflow or custom block with one of its blocks, whether in the working copy or only in a promoted production version. The dialog lists each one as a link. Remove those blocks first (and promote, if the use was in production), then remove the plugin.

::: tip
To stop a plugin running without removing it, turn off its **Dev** and **Prod** switches ([approval](./approving#dev-and-prod-switches)).
:::
