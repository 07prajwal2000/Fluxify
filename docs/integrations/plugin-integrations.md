---
title: Integrations from Plugins
description: How integrations a plugin adds appear in a project, how to create and test one, and what a disabled plugin means for the integrations it provided.
---

# Integrations from plugins

A [plugin](/plugins/) can add integrations as well as blocks. A plugin integration connects Fluxify to a service the built-in categories do not cover, or connects to a familiar service in a different way.

There are two kinds:

| Kind | Where it appears | What can use it |
| :--- | :--- | :--- |
| **A variant of a built-in category** | Under **Databases**, **KV Stores**, **Queues** and so on, with a **Plugin** badge | The built-in blocks of that category, and the plugin's own blocks |
| **A category of the plugin's own** | Under **PLUGIN INTEGRATIONS**, grouped by the plugin's scope | Only the blocks of the same plugin |

The plugin must be approved and enabled in the environment where you use its integrations. Approval is covered in [Approval and permissions](/plugins/approving).

## Creating one

1. Open **Integrations** in the project.
2. Press **Connect App / Service**.
3. Pick the category: a built-in one with a **Plugin** badge, or the plugin's own category under **PLUGIN INTEGRATIONS**.
4. Pick the variant, such as the plugin's **Redis** or **SMTP** connection.
5. Fill in the form, give the integration a name, and save.
6. Press **Test connection** on the saved integration to check the development details.

The form is designed by the plugin. It can have tabs, hints and any of the usual fields. A field the plugin marked as a secret is not a text box: press **Pick Key** and choose an [App Config](/concepts/app-config) key. Only the key is stored, so rotating the secret later is one change in App Config.

Like every integration, a plugin integration holds a **development** and a **production** config. The development worker uses the development config; the production worker uses the production one. See [Integrations](./) for what *Same as production* does.

## Test connection and Inspect

| Action | What it does |
| :--- | :--- |
| **Test connection** | Opens a connection with the development config and asks the plugin to check it. The answer says whether it worked, and why not when it did not |
| **Test production credentials** | The same check with the production config. Only a signed-in creator or admin can run it |
| **Inspect** | Sends a small request to the integration and shows the answer. For a database variant this is a table's columns; the request and the result are shown as JSON |

The plugin's checks run on a **worker of the same environment**, never in the admin. If no worker of that environment is running, the result says so, for example `No development worker is running for this project.` Start one, or set a development config and use *Same as production*.

## What a disabled plugin means

A plugin can be switched off for development, for production, or for both. Its integrations are **kept**; they are not deleted.

| State | What you see |
| :--- | :--- |
| Plugin off everywhere | Its variants disappear from the integrations page and from **Connect App / Service**. Existing integrations stay in the list with a **plugin disabled** badge |
| Plugin off in production only | Development works. Production fails when a route uses the integration |
| Plugin off in development only | Production works. Development fails when a route uses the integration |

A route or block that uses an integration of a disabled plugin fails with a message naming the plugin, such as `plugin acme/crm is disabled` or `plugin acme/crm is disabled in production`. Turn the plugin's switch back on to use the integration again; nothing about the integration changes.

While a plugin is off everywhere, creating another integration of its kinds is refused. Existing integrations can still be edited and deleted.

## Removing a plugin

A plugin cannot be removed while the project has an integration of one of its kinds, because that integration would point at a connection nothing provides. Remove the integrations first, then the plugin. The remove dialog lists each one as a link. See [Upgrading and removing](/plugins/upgrading#removing-a-plugin).

## A worked example

The [integrations example plugin](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/integrations) adds a **Redis Cache** variant under KV Stores and an **SMTP** connection under the plugin's own `email` category, plus a Send email block that uses it. Its README lists each file.

Plugin authors can read [Integrations](/plugins/authoring/integrations) for the code side.
