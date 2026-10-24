---
title: Plugins
description: What plugins are, how they differ from custom blocks, who can add and approve them, and why nothing runs until a creator approves it.
---

# Plugins

A **plugin** is a package that adds new blocks to Fluxify, and optionally new integrations and triggers. Someone writes it in code, builds it into a `.tgz` archive, and shares it. You add it to your project, a creator approves it, and its blocks appear in the block picker next to the built-in ones.

Use a plugin when a block needs real code: a call to a service with its own library, a calculation you don't want to rebuild from other blocks, or a block your whole team should get from one versioned package.

## Plugins and custom blocks

| | Custom block | Plugin |
| :--- | :--- | :--- |
| Built with | Other blocks, on a canvas | Code, in a package |
| Lives in | One project | A package you add to a project |
| Versions | Saved and promoted inside Fluxify | An exact version number from the package |
| Shown in the picker under | **Custom** | **Plugins** |
| Settings form | You design it | The plugin's author designs it |

If you can build it by wiring blocks together, a [custom block](/blocks/custom-blocks) is simpler. Reach for a plugin when you need code.

## Nothing runs until a creator approves it

Plugin code runs inside Fluxify, so every plugin waits for approval.

1. You add the plugin ([ways to add one](./installing)). It shows **Pending approval**.
2. A creator reviews what it asks for and approves it ([approval](./approving)).
3. Its blocks start working in the environments you turned on.

Until step 2, you can still draw its blocks on a canvas, but they will not run, and a route that uses one cannot be promoted to production.

## Who can do what

| Action | Viewer | Creator and above | Instance admin |
| :--- | :---: | :---: | :---: |
| See the plugin list, a plugin's page and its status | Yes | Yes | Yes |
| Add, approve, reject, remove, scan, switch Dev and Prod | No | Yes | Yes |
| Choose which domains plugin links may come from | No | No | Yes |

## Where to find them

- **Settings → Plugins** in a project lists the plugins, and is where you add, approve and remove them.
- The **Plugins** section of the block picker on a canvas offers their blocks ([using them](./blocks-on-canvas)).
- The **Custom Blocks** page can also list them, read-only, with **Show plugin blocks**.
- **Integrations** lists the services a plugin adds, under their built-in category or the plugin's own ([integrations from plugins](/integrations/plugin-integrations)).
- **Triggers → New trigger** offers their trigger kinds on the **Source** step, marked **Plugin** ([triggers from plugins](/concepts/triggers#triggers-from-plugins)).

## In this section

- [Adding a plugin](./installing)
- [Approval and permissions](./approving)
- [Upgrading and removing](./upgrading)
- [Status and troubleshooting](./status)
- [Plugin blocks on the canvas](./blocks-on-canvas)

## Writing your own

Plugin authors start with [Writing a plugin](./authoring/getting-started). It covers the CLI, the block API, testing and publishing.

From there:

- [Blocks](./authoring/blocks): every field of `block()`
- [Integrations](./authoring/integrations): add a connection, and narrow an integration param to the variants you support
- [Triggers](./authoring/triggers): wait for a signal from any source, run the workflow, and design for at-least-once delivery
- [Testing](./authoring/testing): `runBlock`, `runIntegration` and `runTrigger`
