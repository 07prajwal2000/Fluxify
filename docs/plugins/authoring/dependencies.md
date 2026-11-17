---
title: Plugin Dependencies
description: Use and extend the integration groups another plugin adds, by declaring that plugin as a peer dependency, and what happens when a project installs, approves or switches off a plugin with dependencies.
---

# Plugin dependencies

A plugin can build on another plugin. If `other/crm` adds an integration group `other/crm`, your plugin can have blocks and triggers that use that group, instead of writing the same connection again. It can also add a new variant to that group, such as another CRM provider, which the blocks of `other/crm` then work with.

The plugin you build on is a **dependency**. Your plugin is its **dependent**.

## Declaring a dependency

Add the other plugin's npm package to `peerDependencies` in your `package.json`, and to `devDependencies` so it is installed while you build and test:

```json
{
  "name": "@acme/sales",
  "peerDependencies": {
    "@fluxify/sdk": ">=2026.10.2001",
    "zod": "^4.0.0",
    "@other/crm": "^1.2.0"
  },
  "devDependencies": {
    "@other/crm": "^1.2.0"
  }
}
```

Then run `bun install` and build as usual. The build looks at every peer dependency. A peer whose package is a Fluxify plugin becomes a dependency, and `fluxify.json` records its package, its plugin name and your range:

```json
"dependencies": [{ "name": "@other/crm", "plugin": "other/crm", "range": "^1.2.0" }]
```

Other peers, such as `@fluxify/sdk` and `zod`, are left out.

## Using the dependency's group

Name the dependency's group, or one of its variants, in `permissions.integrations` and in `param.integration`, exactly as you would one of your own:

```ts
import type { CrmClient } from "@other/crm";
import { block, param } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/sales/find-customer",
	label: "Find customer",
	permissions: { integrations: ["other/crm"] },
	params: { crm: param.integration({ kind: "other/crm" }) },
	async run({ params, ctx }) {
		const crm = (await ctx.integrations.get(params.crm)) as CrmClient;
		return { output: await crm.findCustomer("42") };
	},
});
```

The build checks each kind against the dependency's own `fluxify.json` in `node_modules`. A group or a variant the dependency does not declare fails the build, naming what is known.

::: warning Types only
Import a dependency with `import type`, never as code. The client always comes from the project's integration, through `ctx.integrations.get`, and the worker does not install a copy of the dependency next to your plugin. A build whose output imports a dependency fails, naming the file.
:::

## Adding a variant to the dependency's group

Write the dependency's group, with its scope, as the `group` of your integration:

```ts
// types only: the client other/crm expects
import type {} from "@other/crm";
import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";

export default integration({
	name: "acme/sales/pipe",
	label: "Pipe CRM",
	icon: "./icons/pipe.svg",
	group: "other/crm",
	variant: "Pipe",
	config: { token: param.secret({ label: "API token", required: true }) },
	connect(config, ctx) {
		const token = ctx.getConfig(config.token);
		return {
			async findCustomer(id: string) {
				// call Pipe CRM with the token
				return { id, source: "pipe" };
			},
		};
	},
});
```

`bunx fluxify-cli integrations create pipe --group other/crm` writes this file for you.

In a project, the variant appears under the dependency's group on the integrations page, next to the dependency's own variants, labelled with your plugin's name. The blocks and triggers of `other/crm` that take an integration of its group can pick it, and so can your own blocks.

The build checks it against the dependency's `fluxify.json`:

| Problem | What the build says |
| :--- | :--- |
| The group's plugin is not a dependency | `group 'other/crm' is not a group of a plugin this one depends on: add the plugin that declares it to peerDependencies` |
| The dependency has no such group | `plugin other/crm declares no integration group 'other/billing' (other/crm)` |
| The dependency already has a variant with that name | `variant 'Hub' of other/crm is already provided by plugin other/crm` |

::: info Direct dependencies only
You can add to, and use, the groups of the plugins in your own `peerDependencies`. A group of a plugin that only your dependency depends on is not available to you: add that plugin as a dependency too.
:::

When your plugin is approved in a project, a variant name already taken in that group is refused, and the message names both plugins. This covers the dependency's own variants and the ones other plugins added.

Your variant is offered only while your plugin runs. When the dependency is missing, waiting for approval, rejected or switched off, your plugin stops, and its variants leave the group with it.

## Typing a group's client

A plugin that declares a group can say what its client looks like, so that a variant another plugin adds is checked against it. In the package of the plugin that declares the group, add the client to `PluginGroups`:

```ts
// index.d.ts of @other/crm, listed in the "files" of its package.json
export type CrmClient = {
	findCustomer(id: string): Promise<{ id: string; source: string }>;
};

declare module "@fluxify/sdk" {
	interface PluginGroups {
		"other/crm": CrmClient;
	}
}
```

You write this by hand; the build does not generate it. A plugin that imports the package with `import type` then gets a type error when its `connect` for `other/crm` returns something that is not a `CrmClient`. A group that is not in `PluginGroups` accepts any client, as before.

::: tip
Types are checked while you write the plugin, not in the project. A project trusts the variant like any other plugin code, and every variant names the plugin that adds it, so a broken client is easy to trace.
:::

## What happens in a project

| Step | What the project sees |
| :--- | :--- |
| **Adding from npm** | Before anything is installed, the dialog lists each dependency that will come along, with its exact version. Pressing **Install** adds them first, then your plugin. Each one waits for approval |
| **Adding another way** (upload, link, folder) | Your plugin is added on its own. Its page shows the missing dependencies under **Dependencies**, with an **Install missing dependencies** button that shows the same list first |
| **Approving** | Your plugin cannot be approved while a dependency is missing, waiting for approval, rejected, or at a version outside your range. Approve the dependency first |
| **Running** | Your plugin only runs where its dependencies run. If a dependency is switched off in an environment, or rejected, your blocks in that environment stop with a message that names the dependency |

The plugin page lists, under **Dependencies**, what the plugin **depends on** (with the installed version and its approval) and which plugins are **used by** it.

## Versions

A project holds **one version** of each plugin. When your plugin is installed:

- A dependency already installed at a version inside your range is kept.
- A dependency outside your range is upgraded to the newest version inside it, but only if every other plugin that needs it accepts that version too.
- If another plugin's range does not accept it, the install is refused and the message says who needs which range. Nothing is installed.
- A dependency is always picked from the npm registry, and the project's release-age rule applies to it too.

::: info
Plugins cannot depend on each other in a circle. If `a` needs `b` and `b` needs `a`, the install is refused and the message shows the circle: `a -> b -> a`.
:::

## Not supported yet

- Removing a plugin that others depend on is not yet blocked, and a dependency's upgrade does not yet check what its dependents use.
