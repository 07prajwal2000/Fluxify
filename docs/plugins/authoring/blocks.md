---
title: Block Reference
description: Every field of block() for plugin authors, with a small example of each, how run returns a result, and how errors are handled.
---

# Blocks

A block is a file in `src/blocks` that default-exports `block({...})`:

```ts
import { block, param } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/slack/messages/post",
	label: "Post message",
	params: { channel: param.string({ required: true }) },
	async run({ params }) {
		return { output: `posted to ${params.channel}` };
	},
});
```

`block()` checks the definition when the file loads and throws an error that names the block, so a mistake shows up in `bun test` and in the build. Only `name`, `label` and `run` are required.

## Fields

| Field | Required | Default | What it is |
| :--- | :---: | :--- | :--- |
| [`name`](#name) | Yes | | The block's type: `scope/name/folder/block` |
| [`label`](#label) | Yes | | The name shown on the canvas and in the picker |
| [`description`](#description) | No | | One line shown in the picker |
| [`icon`](#icon) | No | A default icon | An image inside the plugin |
| [`shape`](#shape) | No | `square` | `square` or `wide` |
| [`docs`](#docs) | No | | Markdown for the block's Docs tab |
| [`invoke`](#invoke) | No | `sync`, `async`, `queued` | The ways a canvas may call the block |
| [`permissions`](#permissions) | No | None | What `ctx` may reach |
| [`params`](#params) | No | None | The settings the user fills in |
| [`tabs`](#tabs) | No | By first use | The order of the settings tabs |
| [`handles`](#handles) | No | In `target`, out `source` | Inputs, outputs and nested chains |
| [`run`](#run) | Yes | | The code |
| [Deprecation](#deprecation) | No | | A message that the block is going away |

### name

The block's type. It must be the plugin name plus the path of the file under `src/blocks`, in lowercase. The build stops if they differ. See [names](./getting-started#names).

The type is also part of the id a recorded run stores for the block, `<plugin>@<version>:<project id>:<block type>`, which holds **500 characters**. The build budgets the longest project id (50) and stops, naming the block and how far over it is, when the id could not fit. Shorten the plugin name or a folder if that happens.

```ts
name: "acme/slack/messages/post", // src/blocks/messages/post.ts in acme/slack
```

### label

What the user sees on the canvas and in the picker.

```ts
label: "Post message",
```

### description

A short line under the label in the picker.

```ts
description: "Posts a message to a Slack channel.",
```

### icon

A path to an image inside the plugin: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`. The build copies an icon from outside `icons/` into `icons/` so it ships, and stops if the image is missing or too large (about 50 KB).

```ts
icon: "./icons/post.svg",
```

### shape

`square` is the usual one-icon block. `wide` draws a wider node on the canvas, as the Agent block in the [example plugin](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools) does.

```ts
shape: "wide",
```

### docs

Markdown shown in the block's **Docs** tab. Follow the page layout of the built-in blocks: a sentence, then **When to use it**, **Inputs**, **Outputs**, **Example** and **How it behaves**. A block with no docs gets a build warning.

```ts
docs: `Posts a message to a channel.

## When to use it
After a block that builds the text.

## Inputs
| Name | Required | Default |
| :--- | :--- | :--- |
| Channel | Yes | |`,
```

The Docs tab shows a small subset of markdown. The build warns about the rest:

- Use headings, paragraphs, lists, tables, code fences and the callouts `::: info`, `::: tip`, `::: warning` and `::: danger`.
- Do not use raw HTML, images, `{#id}` on headings, or `[text](#anchor)` links. The tab opens every link in a new tab, so an in-page link goes nowhere.

### invoke

The ways a canvas may call the block. With one mode the user gets no choice; with more, the block's settings show an **Execution Mode** dropdown.

| Mode | The caller |
| :--- | :--- |
| `sync` | Waits for the block, and uses its output |
| `async` | Starts it on this worker and carries on |
| `queued` | Puts it on a queue for a worker to pick up, and carries on |

`async` and `queued` calls pass their input and params as JSON, and the caller never learns the outcome. The [handles page](./handles#invoke-modes) lists the combinations Fluxify refuses.

```ts
invoke: ["sync"], // the output holds a function, which only a sync call can pass on
```

### permissions

What `ctx` may reach, beyond what every block gets. A creator sees it when approving the plugin, and the approval covers exactly what you ask for. [Context](./context#permissions) lists them.

```ts
permissions: { integrations: ["database"], appconfig: true },
```

### params

The settings the user fills in, typed from the declaration so `params` in `run` has the right types. See [params](./params).

```ts
params: {
	channel: param.string({ label: "Channel", required: true }),
	silent: param.boolean({ default: false }),
},
```

### tabs

The settings tabs in order. Without it, tabs appear in order of first use with **General** first. A param's `tab` that `tabs` leaves out is added after the listed ones, and the build warns about it.

```ts
tabs: ["General", "Advanced"],
```

### handles

Inputs, outputs and nested chains. See [handles](./handles).

```ts
handles: { out: [handle.out("success"), handle.out("failure")] },
```

### run

```ts
async run({ params, input, ctx, executeHandle }) {
	return { output: params.channel, handle: "success" };
},
```

| Argument | What it is |
| :--- | :--- |
| `params` | The settings, typed from `params`. Defaults are filled in, `required` ones are checked, and `js:` values are already evaluated ([params](./params)) |
| `input` | The previous block's output |
| `ctx` | The block's context ([context](./context)) |
| `executeHandle` | Runs the chains on the block's body handles ([handles](./handles#executehandle)) |

`run` returns an object, or nothing:

| Return | Meaning |
| :--- | :--- |
| `{ output }` | `output` goes to the next block |
| `{ output, handle }` | The same, leaving by a declared output handle. The default is the first one |
| nothing | The output is `undefined` |

Returning a handle the block did not declare fails the run with an error that lists the handles it has.

### Errors

A block fails by throwing. Where the failure goes depends on its outputs:

| Outputs | A throw |
| :--- | :--- |
| `[success, failure]` | Leaves by `failure` with the error's message as its output, if something is wired to `failure`. Otherwise it fails the route |
| `[source]` or `[]` | Fails the route |

Returning `{ handle: "failure", output }` yourself takes the same path without a throw.

A missing required param, or a value of the wrong type, is an error thrown before your code runs, so it is routed like any other throw. A `js:` expression that throws fails the route before the block is called, and never goes to `failure`.

```ts
async run({ params, ctx }) {
	const res = await ctx.vars.httpClient.get(params.url);
	if (res.status !== 200) throw new Error(`the server answered ${res.status}`);
	return { output: res.data, handle: "success" };
},
```

### Deprecation

Wrap the finished block in `deprecated(...)` with a message for the user. The message is shown as written, so say what to use instead and when the block goes away. [Publishing](./publishing#deprecate-before-you-remove) covers when to use it.

```ts
import { block, deprecated } from "@fluxify/sdk/blocks";

export default deprecated(
	block({ name: "acme/slack/post", label: "Post (old)", async run() {} }),
	"Removed in the Jan 2027 release; use `acme/slack/messages/post`.",
);
```

`deprecated` takes a param or a handle in the same way. See [params](./params#deprecating-a-param) and [handles](./handles#deprecating-a-handle).

## A complete block

This is the Tool block of the [agent-tools example](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools). It uses a param, a body handle and a late `executeHandle` call, all covered in the next pages.

```ts
// source: examples/plugins/agent-tools/src/blocks/tool.ts
export default block({
	name: "fluxify-examples/agent-tools/tool",
	label: "Tool",
	description: "A tool an Agent block can call. Wire what it does to its Execute handle.",
	shape: "square",
	// the output holds a function, which only a sync call can pass on
	invoke: ["sync"],
	params: {
		name: param.string({ label: "Name", required: true }),
		description: param.string({ label: "Description", default: "" }),
	},
	handles: {
		out: [],
		body: [handle.body("execute", "bottom-right")],
	},
	async run({ params, executeHandle }) {
		return {
			output: {
				name: params.name,
				description: params.description,
				// runs after this `run` returned, while the agent's run is still going
				call: (args: unknown) => executeHandle("execute", args),
			},
		};
	},
});
```
