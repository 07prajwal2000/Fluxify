---
title: Approval and Permissions
description: What a creator sees when approving a plugin, what each permission lets it do, when a plugin goes back to pending, and how the Dev and Prod switches work.
---

# Approval and permissions

A plugin does nothing until a creator approves it. Open **Settings → Plugins**, select the plugin, and press **Review & approve**.

## What the approval dialog shows

| Section | What it tells you |
| :--- | :--- |
| **Blocks** | The blocks the plugin adds, with their shape and the ways they can run |
| **Integrations provided** | The integration variants the plugin adds, when it has any |
| **Triggers provided** | The trigger kinds the plugin adds, what each may reach, and whether Fluxify retries its runs |
| **Approving grants** | Everything the plugin is asking to use, and what you grant by approving |
| **Package** | Where it came from (upload, npm, link or folder), its exact version, and the Fluxify versions it supports |

A plugin that asks for nothing special shows **No special permissions**.

## Permissions

By default a plugin's blocks can only work with the data passed to them. A permission lets them reach further.

| Permission | What it allows |
| :--- | :--- |
| **Use the database integration** | Use the project's database connections |
| **Use the kv integration** | Use the project's key-value stores |
| **Use the queue integration** | Use the project's queues |
| **Use the acme/email integration** | Use the project's integrations of a group the plugin adds. The name is the permission's kind |
| **Read app config** | Read **any** of the project's App Config values |
| **Read the app config keys chosen in: ...** | Read only the keys someone picks in the fields listed. No other key can be read |

A permission names a **kind**: a group (`kv`, `acme/email`) or one variant of it (`kv/Redis`, `acme/email/smtp`). A group covers every variant of that group; a variant covers only itself.

Adding an integration does not need a permission. The permission is for a **block or trigger** that uses one, and the approval covers the kinds the plugin's blocks and triggers ask for. A trigger asks for the same permissions a block does.

A block or trigger that tries to use something it was not granted fails with a message naming the missing permission.

## What happens with App Config

| The plugin's... | Without **Read app config** | With **Read app config** |
| :--- | :--- | :--- |
| **Block** | Reading any value fails with an error, and nothing is read | Reads any key |
| **Trigger** | Reads only the key a user picked in one of its secret fields. Any other key fails with an error, and the trigger is turned off straight away | Reads any key |
| **Integration** | Reads only the key a user picked in one of its secret fields. Any other key fails with an error | Same: an integration never reads other keys |

A secret field stores the name of a key that a person in your project picks, not its value. The plugin cannot choose the key itself, which is why a secret field does not need **Read app config**. The dialog still lists these fields under **Approving grants**, because the plugin can read the value of whatever key is picked there.

Approval covers the whole plugin. If any one block or trigger asks for **Read app config**, every block and trigger in that plugin can read any key once you approve it.

Fluxify also checks these rules when a plugin is added and when it loads:

- A plugin whose `fluxify.json` has a field that needs a permission it does not ask for is refused when you add it, even if the file was edited by hand.
- A trigger or integration whose code declares different secret fields from the ones you approved does not load. The plugin's status or the trigger's failure message says so.

::: warning Approval is a decision to trust the plugin's source
A permission limits what a plugin is *given*. It is not a sandbox: plugin code runs inside Fluxify, so code written to get around these rules could reach things the permission does not cover. Approve only plugins whose source you trust.
:::

## When a plugin goes back to pending

Approval is for one exact build of one version. A plugin returns to **Pending approval** when:

- you upload a **new version**, or the same version with **different contents**
- it asks for **more permissions** (any change to what it asks for comes with a new build)

An approved plugin that gets a pending upgrade keeps serving its **old version** until you approve the new one ([upgrading](./upgrading)).

If you **reject** a plugin that has never been approved, none of its blocks load. You can approve it later.

A folder plugin whose files change on the server after approval is not reloaded: its workers report an error until you add it again from the Folder tab and approve the new contents.

## Dev and Prod switches

Each plugin has a **Dev** and a **Prod** checkbox in the list.

| Switch | Default | Meaning |
| :--- | :---: | :--- |
| **Dev** | On | The approved plugin's blocks and triggers run in the development environment |
| **Prod** | Off | The approved plugin's blocks and triggers run in production |

Turn **Prod** on when you are ready for production to use the plugin. A route or workflow that uses a plugin block can only be promoted to production while that plugin is approved and enabled there. Turning a switch off stops the blocks from loading in that environment, so any route that uses them stops working there.

A plugin trigger runs where its plugin is enabled **and** the workflow it starts is live. Turning the plugin's switch off stops the trigger; the trigger row and its settings are kept, and turning the switch back on starts it again. Its existing integrations stay too, marked **plugin disabled** ([status](./status#integrations-a-plugin-provides)).

Approving, rejecting and changing a switch are recorded in the audit log and recompile the project's routes.
