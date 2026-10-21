---
title: Plugin Blocks on the Canvas
description: How to find, place and configure a plugin's blocks on the canvas, including the settings tabs, the Docs tab, deprecated blocks and the plugin not installed placeholder.
---

# Plugin blocks on the canvas

Once a plugin is added, its blocks work like any other block. Wire them, set them up, and run them.

## Finding them

Open the block picker. Plugin blocks have their own top-level **Plugins** section, separate from **Custom**. It is organised as folders: the plugin's author, then the plugin, then any groups the plugin defines.

```text
Plugins → acme → slack → messages → Post message
```

- Search finds a block by its name or its path.
- Deprecated blocks are listed last and carry a **Deprecated** badge.
- The spotlight search (**Add Block: ...**) offers the same blocks.
- A plugin that is still **Pending approval** is not offered in the picker, because it cannot run. You can still open a canvas that already contains its blocks.

## Shape and connection points

A plugin block looks like a built-in block:

| Shape | Looks like |
| :--- | :--- |
| Compact | A small square card |
| Wide | A larger card, like the HTTP Request block |

It can have an input on the left, one or more outputs on the right (for example **success** and **failure**), and **body connection points** on its corners. A body connection point lets you attach a branch of blocks that the plugin runs when it needs to, such as the steps inside a loop. When a body connection point accepts only one branch, it is full after one connection.

## Settings

Select a block to open its settings. The tabs are:

| Tab | What it holds |
| :--- | :--- |
| **General** | **Execution Mode**, shown only when the plugin allows more than one way to run: Synchronous (wait for output), Asynchronous (fire and forget) or Queued (durable background job). A deprecated block shows its banner here. Otherwise it points you to Parameters |
| **Parameters** | The block's settings, as designed by the plugin's author. If the plugin groups them, they appear under their own tabs. A tab is hidden when all of its settings are hidden, and there is no tab bar for a single tab |
| **Docs** | The plugin's own documentation for the block, and a link to the plugin's page |

A setting marked required shows a marker, and a default shows as placeholder text. Some settings only appear when another setting has a certain value, and a hidden setting keeps what you typed. Settings can take code with a `js:` prefix, which is run when the route runs. Deprecated settings are labelled with the author's message.

On a read-only canvas every setting is disabled.

## Deprecated blocks

A block the author is phasing out shows a **Deprecated** badge on the canvas, in the picker and in its settings. Hover for the message. It keeps working. Plan to replace it before a later version removes it ([upgrading](./upgrading#deprecations)).

## "Plugin is not installed"

If a block's plugin was removed or was never added to this project, the block turns into a dashed placeholder reading **Plugin acme/x is not installed**. Its connections stay in place so nothing is lost. Add the plugin back ([adding a plugin](./installing)) and the block returns to normal.

## Plugin blocks on the Custom Blocks page

The **Custom Blocks** page can list plugin blocks too. Tick **Show plugin blocks** (off by default). They are grouped by plugin, with the plugin's approval and status and an **Open plugin** link. This list is read-only: to change a plugin use **Settings → Plugins**. See [Custom Blocks](/blocks/custom-blocks).
