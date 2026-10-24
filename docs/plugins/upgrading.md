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
| **Triggers** | Trigger kinds the new version adds, removes or changes, and the triggers of yours each change affects |
| **Deprecations** | Things the author marked as going away. **In use** means one of your routes uses it now |

### What blocks an upgrade

An upgrade is **blocked** when it removes something your project uses: a block, a setting, a connection point, or a way of running that a block in a route, workflow or custom block depends on. Both the working copy and the promoted production version count.

Changing a `number` param's `min`, `max` or `integer` rule is listed under the same section, and blocks while a saved value falls outside the new bounds. Widening a range, or adding a limit every saved value already meets, breaks nothing.

The same rule covers the integrations a plugin provides. These changes block an upgrade **while the project has an integration of that kind**:

| Change | Why it blocks |
| :--- | :--- |
| A variant is removed | Its integrations would point at a variant nothing provides |
| A variant moves to another group | Its kind changes, so existing integrations no longer match |
| A config field is removed | The stored config has a value that is no longer accepted |
| A config field is now required, with no default | Existing integrations have no value for it |
| A config field changes type | The stored value may not fit the new type |
| A field changes between secret and plain | The stored form is different (`cfg:KEY` versus a value) |
| A number config field's bounds are narrowed | A saved config value may fall outside the new range |

These do **not** block an upgrade, even while integrations exist:

- an optional config field is added
- a default, label, description, icon, docs, help text, tab or order changes
- a number field's bounds are widened, or a bound every saved value already meets is added
- a variant is added
- Test connection, metadata or inspect is added, changed or removed

A blocking change only matters when an integration of that kind exists. Removing a variant the project never configured is fine, and a **new** variant never affects existing rows. The preview lists each blocking integration as a link, so you can open it and remove it before approving.

### Trigger kinds

A trigger the project created keeps its settings in the project, so a change to its kind blocks the upgrade **while a trigger of that kind exists**:

| Change | Why it blocks |
| :--- | :--- |
| A trigger kind is removed | Its triggers would have no code to start |
| A param is now required, with no default | Existing triggers have no value for it |
| A param is removed, changes type, or changes between secret and plain | The stored value may not fit the new param |
| An integration param now takes a different kind | The stored integration may be of the wrong kind |
| A permission is dropped | An existing trigger may use it |
| `variants` is narrowed | A stored integration may be of a dropped variant |
| A number param's bounds are narrowed | A saved value may fall outside the new range |

These do **not** block, even while triggers exist:

- a new trigger kind
- an optional param is added
- a label, description or icon changes
- `retry` is turned on or off. It is listed, and a trigger that stays on keeps its **Max attempts** setting

The trigger changes follow the same rule as blocks and integrations: the preview names each affected trigger as a link, and the upgrade is refused while one remains. Removing a trigger kind the project never used is fine.

::: info One integration row covers both environments
An integration holds its development and production configs together. Deleting it removes both, so one row is one use in the upgrade preview.
:::

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

Removal is **blocked while anything uses it**: a route, workflow or custom block with one of its blocks, whether in the working copy or only in a promoted production version. It is also blocked while the project has an **integration of one of the plugin's kinds**, because that integration would point at a variant nothing provides, and while the project has a **trigger created from one of its kinds**, because that trigger would have no code to start. The dialog lists each block use, each integration and each trigger as a link. Remove those first (and promote, if the use was in production), then remove the plugin.

::: tip
To stop a plugin running without removing it, turn off its **Dev** and **Prod** switches ([approval](./approving#dev-and-prod-switches)). Its triggers stop and keep their settings, and its integrations keep working once the switch is back on.
:::
