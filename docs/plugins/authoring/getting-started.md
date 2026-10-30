---
title: Writing a Plugin
description: Create, test, build and ship a Fluxify plugin with the CLI, what is in a plugin package, and how blocks are named.
---

# Writing a plugin

A plugin is one package of blocks, and optionally integrations and triggers. You write each one as a small TypeScript file, test it without a running Fluxify, build it into a `.tgz` archive, and hand that to your team or publish it to npm. This page takes you from nothing to a built plugin. The pages after it cover each part in detail.

::: warning The SDK and CLI are not on npm yet
`@fluxify/sdk` and `@fluxify/cli` live in the [Fluxify repository](https://github.com/Fluxify-rest/Fluxify) (`packages/sdk` and `packages/cli`) and will be published to npm. Until they are, `bun add` and `bunx` for them fail. Work from a checkout instead: run the CLI as `bun packages/cli/bin.ts`, or start your plugin inside the repository like the [agent-tools example](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools). Everything below is the same once they are published.
:::

You need [Bun](https://bun.sh). The CLI, the tests and the build all run on it.

## 1. Create the plugin

```sh
bunx fluxify-cli init acme-slack --name acme/slack --url https://github.com/acme/fluxify-slack
cd acme-slack
```

| Flag | Meaning |
| :--- | :--- |
| `--name <scope/name>` | The plugin's name. Asked for on a terminal when left out |
| `--url <https url>` | Where its docs or source live. Asked for on a terminal when left out |
| `--force` | Overwrite files that exist, and take over a `package.json` that is not a plugin's |
| `--no-install` | Skip `bun install`. Run it yourself before you build |

`init` writes an empty plugin and runs `bun install`.

## 2. Add a block

```sh
bunx fluxify-cli blocks create messages/post
```

This writes `src/blocks/messages/post.ts` and a test next to it. The block's type is the plugin name plus its path: `acme/slack/messages/post`. Open the file and replace the example with your block ([the block reference](./blocks)).

A plugin can also add an integration ([reference](./integrations)) and a trigger ([reference](./triggers)):

```sh
bunx fluxify-cli integrations create mail --group email
bunx fluxify-cli triggers create orders
```

## 3. Test it

```sh
bun test
```

`runBlock` runs one block the way Fluxify would, with no server, database or network. [Testing](./testing) explains how to fake what a block talks to.

## 4. Build it

```sh
bun run build
```

`bun run build` is `fluxify-cli blocks build`. It bundles every block, works out the type each block outputs from its `run` (so the next block's editor can complete `input`), writes `fluxify.json`, and packs everything into `acme-slack-0.1.0.tgz` (the plugin name with `/` as `-`, then the version from `package.json`). It prints a warning for each thing worth fixing and stops on each thing that would make Fluxify refuse the plugin:

| Stops the build | Warns |
| :--- | :--- |
| `src/index.ts` missing or invalid, or an `https://` `url` missing | A block has no `docs` |
| No blocks in `src/blocks` | A block's `docs` uses markdown the portal's Docs tab cannot show |
| A block's name is not the plugin name plus its path | A param is in a tab that `tabs` does not list |
| A block definition Fluxify would refuse (a reserved param name, a `visibleWhen` that names no param, and so on) | `executeHandle(...)` is not awaited |
| `@fluxify/sdk` or `zod` in `dependencies` | An output type is too long to keep, so the editor uses `any` for it |
| Runtime `dependencies` without a usable `bun.lock` | |
| An icon that is missing, outside the plugin, not an image, or too large | |

::: tip Version numbers
`version` in `package.json` must be three plain numbers, like `0.1.0` or `1.4.2`. The build accepts a suffix such as `-beta.1`, but Fluxify refuses it when the plugin is added.
:::

## 5. Ship it

| Way | How |
| :--- | :--- |
| **Upload** | Give the `.tgz` to whoever runs the project. They upload it in **Settings → Plugins** ([adding a plugin](/plugins/installing)) |
| **npm** | Run `bun run build`, then `bun publish`. Users add it by package name and exact version. The package carries `fluxify.json`, which is how Fluxify recognises a plugin |

Nothing runs until a creator in the project approves the plugin ([approval](/plugins/approving)). See [publishing](./publishing) for versions and upgrades.

## What is in a plugin

```
acme-slack/
├─ package.json        name, version, peer dependencies
├─ bun.lock            needed only if the plugin has runtime dependencies
├─ src/
│  ├─ index.ts         plugin({ name, url, ... })
│  ├─ blocks/
│  │  └─ messages/
│  │     ├─ post.ts          a block
│  │     └─ post.test.ts     its test
│  ├─ integrations/          optional: connections the plugin adds
│  └─ triggers/              optional: sources that start a workflow
├─ icons/              images the plugin or its blocks use
├─ dist/               built blocks (generated)
└─ fluxify.json        the manifest (generated)
```

**`src/index.ts`** describes the plugin itself:

```ts
import { plugin } from "@fluxify/sdk";

export default plugin({
	// permanent: a different name is a different plugin
	name: "acme/slack",
	url: "https://github.com/acme/fluxify-slack",
	description: "Post to Slack from a route.",
	// the plugin's folder in the block picker, and the folder of every acme plugin
	// icon: "./icons/plugin.svg",
	// scopeIcon: "./icons/scope.svg",
});
```

**`fluxify.json`** is written by every build from `src/index.ts` and your blocks. Do not edit it: the next build overwrites it. It is in `.gitignore` but still ships in the package.

**`package.json`** gets a `fluxify: { name, url }` field. The build adds it when missing and stops if it disagrees with `src/index.ts`.

**`bun.lock`** is required only when the plugin has runtime `dependencies`. Workers install those from the lockfile exactly, so commit it. A plugin with no runtime dependencies needs none.

**Every file in `src/blocks`** (except `*.test.ts`, `*.spec.ts` and `*.d.ts`) must default-export a `block(...)`. Put shared code anywhere else in `src`, for example `src/model.ts`, and import it from the blocks.

## The peer rule

`@fluxify/sdk` and `zod` are provided by Fluxify. List them in `peerDependencies` (and `devDependencies`, for your tests), never in `dependencies`:

```json
{
	"peerDependencies": { "@fluxify/sdk": ">=2026.10.2001", "zod": "^4.0.0" },
	"devDependencies": { "@fluxify/sdk": ">=2026.10.2001", "zod": "^4.0.0" }
}
```

Every worker runs your blocks on its own copy of both, so a plugin never carries its own and its blocks share one `zod` with the rest of Fluxify. If your plugin uses the AI SDK, `ai` (`^7.0.0`) and `@ai-sdk/provider` (`^4.0.0`) follow the same rule: the worker provides them. The `@fluxify/sdk` range is written into the manifest as the Fluxify versions the plugin supports. Any other package you list in `dependencies` is installed on each worker from `bun.lock`, and is never bundled into your blocks.

## Names

| Thing | Rule | Example |
| :--- | :--- | :--- |
| Plugin | `scope/name`: lowercase letters, digits, `-` and `_` | `acme/slack` |
| Block | The plugin name, then any folders, then the block: `scope/name/folder/block` | `acme/slack/messages/post` |

- **The plugin name is permanent.** Its approval, its blocks in routes and its upgrades all hang on it. A package with a different name is added as a different plugin, not as an upgrade.
- **Long names have a limit.** A recorded run stores each block's id as `<plugin>@<version>:<project id>:<block type>`, and that field holds **500 characters**. The build counts your plugin name, the version, the block's type and the longest a project id can be (50 characters), and stops with an error that names the block and how far over it is. If you hit it, shorten the plugin name, a folder or the block name.
- **A block's type is its path.** `src/blocks/messages/post.ts` must be named `acme/slack/messages/post`. A block can sit directly under the plugin (`acme/slack/post`). Renaming or moving a block breaks every route that uses it, so [deprecate](./publishing#deprecate-before-you-remove) it and add a new one instead.
- **Folders show in the picker.** The block picker and the Custom Blocks page group blocks by `scope/name` and then by these folders.
- **`url` is required** and must be `https://`. It is the Docs link on the plugin and on each of its blocks, so point it at your source or your documentation.

## Next

- [Blocks](./blocks): every field of `block()`
- [Params](./params): the settings a user fills in
- [Handles](./handles): inputs, outputs and nested chains
- [Context](./context): what `ctx` gives a block
- [Integrations](./integrations): connections a plugin adds
- [Triggers](./triggers): sources a plugin watches
- [Testing](./testing): `runBlock`, `runIntegration`, `runTrigger` and their fakes
- [Publishing](./publishing): versions, deprecation and upgrades
