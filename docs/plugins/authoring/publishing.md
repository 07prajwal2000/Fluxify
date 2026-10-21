---
title: Publishing and Versioning Plugins
description: How to version a plugin, deprecate before removing, what makes an upgrade blocking for users, and how to choose between npm, an uploaded .tgz and a folder.
---

# Publishing

You build a plugin once and users add it in one of several ways. After that, every change you ship is an upgrade for people whose routes already use your blocks. This page is about making those upgrades safe.

## Versions

**The version is yours to choose.** Fluxify reads it from `version` in `package.json` and shows it as written. Use whatever numbering your users expect and bump it for every build you ship. The one rule: it must be three plain numbers, like `1.4.0` or `2026.10.2001`. A suffix such as `-beta.1` is refused when the plugin is added, even though the build accepts it, and in semver a suffixed version also sorts *lower* than the plain one.

- Users approve **one exact version**. A new version, or the same version with different contents, is a new approval ([approval](/plugins/approving#when-a-plugin-goes-back-to-pending)). Never re-upload a changed build under the same version.
- Fluxify never picks a version for you. A project runs the version it approved, until someone adds a new one.
- The Fluxify versions your plugin supports are the `@fluxify/sdk` range in `peerDependencies`. The SDK itself is versioned by date (`YYYY.M.DDNN`, such as `2026.10.2001`). A plugin written against an SDK version asks for `>=` that version, and a Fluxify that provides an older SDK refuses to add it, with a message that names both versions.

## Deprecate before you remove

Removing a block, a param or a handle breaks every route that uses it, and Fluxify blocks the upgrade for that reason ([below](#what-blocks-an-upgrade)). The way to make a breaking change is to **deprecate first**, give people time to move, and remove it in a later version.

1. **Ship a version that deprecates it.** It keeps working. Users see a **Deprecated** badge on the block, a banner in its settings, or your message beside the param. The upgrade preview lists it, and marks the ones their routes use.
2. **Say what to do and when it goes away.** The message is shown exactly as you write it.
3. **Remove it in a later version**, once the message has been out long enough.

```ts
import { block, deprecated, handle, param } from "@fluxify/sdk/blocks";

// a param
legacy: deprecated(param.string(), "Ignored since Oct 2026, removed in the Jan 2027 release; use `channel`."),

// a handle
body: [deprecated(handle.body("tools", "bottom-left", { allowMultiple: true }), "Use `skills`.")],

// a whole block
export default deprecated(
	block({ name: "acme/slack/post", label: "Post (old)", async run() {} }),
	"Removed in the Jan 2027 release; use `acme/slack/messages/post`.",
);
```

`deprecated(...)` needs a message and throws without one. A block, param or handle you stop shipping, with no deprecation before it, is the case that blocks upgrades.

## What blocks an upgrade

Users review an upgrade in a preview that compares your new version with the old one ([upgrading](/plugins/upgrading#upgrading)). The upgrade is **blocked**, and the user cannot approve it, when it removes something their project uses:

| You removed | Blocks when |
| :--- | :--- |
| A block | A route, workflow or custom block uses it |
| A param | A block in use has a value set for it |
| A handle | A block in use has something wired to it |
| An invoke mode | A block in use is set to run that way |

Both the working copy and the promoted production version of a route count. These are **shown but do not block**: a new param, a changed shape or handles, a new permission (the plugin goes back to pending approval), and new blocks. Fluxify does not compare param types, so changing one is silent. A required param added to a block that is already in use fails that block's run until the user fills it in, so give it a `default`, or make it optional.

## Choosing how to ship it

| Way | You ship | Good for |
| :--- | :--- | :--- |
| **Uploaded `.tgz`** | The file from `bun run build` | Plugins for one team or company. No registry needed |
| **npm** | `bun publish` after `bun run build` | Plugins for anyone. Users give the package name and an exact version |
| **Folder** | The unpacked build placed on the server | Self-hosted setups where the files are copied onto the instance |

Before you ship any of them:

1. Run `bun test` and `bun run build`. The build must finish without warnings you do not understand.
2. Bump `version` in `package.json`.
3. Check that the `url` in `src/index.ts` still points at your docs. It is the Docs link on the plugin and on every block.

### npm

The published package must contain `fluxify.json` at its root, which `bun run build` writes and `files` in `package.json` includes. Fluxify reads the manifest from the package without running any of its code. A package with no `fluxify.json` is not a plugin. Users must give an exact version: ranges and tags such as `latest` are refused, because an approval is for one version. Publish the build you tested.

### Upload and folder

An upload is the `.tgz` the build wrote. A folder is that archive unpacked into the instance's plugins folder, one subfolder per built plugin ([adding a plugin](/plugins/installing#folder)). Neither involves a registry, so users learn about a new version from you: tell them, and link them to [upgrading](/plugins/upgrading).

## Checklist for a new version

- Every block you removed was deprecated in an earlier version.
- New params have a `default`, or are optional.
- No block's `invoke` list lost a mode that routes use.
- Every new permission is one the plugin needs.
- `docs` says what changed in behaviour.
- `version` is bumped, and `bun run build` passed.
