---
title: Params
description: Every param type a plugin block can declare, what the user sees for it, what run receives, and the options that apply to all of them.
---

# Params

Params are the settings a user fills in on a block. You declare them with `param.<type>(...)` inside `params`, and `run` receives their values, typed from the declaration.

```ts
import { block, param } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/slack/messages/post",
	label: "Post message",
	params: {
		channel: param.string({ label: "Channel", required: true }),
		retries: param.number({ default: 3 }),
	},
	async run({ params }) {
		params.channel; // string
		params.retries; // number
	},
});
```

A param with `required: true` or a `default` is always there, so its type has no `undefined`. Any other param is optional and typed `T | undefined`.

## The types

| Type | The user sees | `run` receives | Extra options |
| :--- | :--- | :--- | :--- |
| `string` | A one-line text box that accepts `js:` expressions | `string` | |
| `number` | A number box | `number` | |
| `boolean` | A checkbox | `boolean` | |
| `select` | A dropdown | One of the `options`, typed as that union | `options` (required) |
| `js` | A code editor | Whatever the code returned | |
| `json` | A JSON editor | A JSON value | |
| `integration` | A picker of the project's integrations of one kind | The integration's id, a `string` | `kind` (required) |
| `appconfig` | A picker of the project's app config keys | The key, a `string` | |
| `conditions` | The same conditions builder the If block uses | `Condition[]` | |
| `schema` | The schema builder | `{ zod, schema }`, compiled | |
| `keyValue` | Rows of a key and a value | `Record<string, unknown>` | `keys.placeholder` |
| `array` | A list of items | `unknown[]` | `of`, `min`, `max` |
| `fieldMap` | A mapper from source field to destination field | `{ [destination]: input[source] }` | |
| `hint` | A callout between the params (not a setting) | Nothing | `text`, `tone` |

## Options every param takes

| Option | What it does |
| :--- | :--- |
| `label` | The name above the field. Without it the param's key is shown |
| `description` | Help text under the label |
| `required` | `run` is only called when there is a value. Otherwise the run fails with `param 'x' is required`. The label shows a `*` |
| `default` | Used when the user left the param empty. Not on `js`, `integration`, `schema` and `fieldMap`, which only the canvas can fill |
| `visibleWhen` | Shows the param only when other params hold given values ([below](#showing-a-param-only-sometimes)) |
| `tab` | The settings tab it sits in. Default `General` |
| `order` | Its position in the tab, lowest first. Params without one follow in declaration order |

A default is used exactly as you wrote it. A `js:` string in a default is not evaluated.

## `js:` values

The user can type a JavaScript expression instead of a plain value by starting it with `js:`. Fluxify evaluates it when the block is called, with the previous block's output available as `input`, and `run` receives the result. This works in `string`, `js`, `json`, `keyValue` and `array` params, in every string inside them. Your code never sees the `js:` text.

| The user types | `run` gets |
| :--- | :--- |
| `#general` | `"#general"` |
| `js:input.channel` | The value of `input.channel` |

A `string` param always arrives as a string: if the expression returns an object it arrives as JSON text, and any other type is converted with `String()`. Use `js` or `json` when you want the value as it is.

## Examples

### string, number, boolean, select

```ts
params: {
	text: param.string({ label: "Message", required: true }),
	retries: param.number({ default: 3 }),
	silent: param.boolean({ default: false }),
	mode: param.select({ options: ["simple", "advanced"], default: "simple" }),
},
```

`select` options must be unique, and `default` must be one of them. `params.mode` is typed `"simple" | "advanced"`.

### js and json

```ts
params: {
	// the user writes code; run gets what it returned
	pick: param.js({ label: "Pick the rows", description: "Return the rows to post" }),
	// a JSON value; strings inside may be `js:` expressions
	extra: param.json({ label: "Extra fields", default: {} }),
},
```

### integration and appconfig

These need a [permission](./context#permissions): an `integration` param needs its kind in `permissions.integrations`, and an `appconfig` param needs `permissions.appconfig: true`. The build refuses a block that has the param without the permission.

```ts
permissions: { integrations: ["database"], appconfig: true },
params: {
	connection: param.integration({ kind: "database", required: true }),
	key: param.appconfig({ label: "Webhook URL key" }),
},
async run({ params, ctx }) {
	const db = ctx.dbFactory!.getDbAdapter(params.connection);
	const url = ctx.vars.getConfig(params.key!);
},
```

### conditions

```ts
params: { when: param.conditions({ label: "Only post when" }) },
```

`run` receives the conditions as the builder stores them. Each is `{ lhs, rhs, operator, chain }`, or `{ group, chain }` for a group. `operator` is `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `js`, `is_empty` or `is_not_empty`, and `chain` is `and` or `or`. The `lhs` and `rhs` sides arrive evaluated.

### schema

```ts
params: { body: param.schema({ label: "Request body" }) },
async run({ params, input }) {
	const parsed = params.body?.zod.safeParse(input);
},
```

The user designs the schema in Fluxify's schema builder, and `run` receives it compiled: `zod` is a ready zod schema and `schema` is the definition itself. A schema is compiled once, when the route is loaded, and shared by every request, so a refinement must not keep state between requests. An empty `schema` param arrives as absent.

### keyValue

```ts
params: {
	headers: param.keyValue({ label: "Headers", keys: { placeholder: "Header name" } }),
},
```

Each value is a literal or a `js:` expression. A row with an empty key, or two rows with the same key, is refused in the settings panel and in `run`.

### array

```ts
params: {
	to: param.array({ label: "Recipients", of: "recipient", min: 1, max: 10 }),
},
```

`of` names one item ("Add recipient"). Each item is a literal or a `js:` expression. Fewer than `min` or more than `max` items fails the run with a message that says so.

### fieldMap

```ts
params: { rename: param.fieldMap({ label: "Rename fields" }) },
```

The user maps source field names to destination names. With `{ id: "userId" }` and an input of `{ id: 7 }`, `run` receives `{ userId: 7 }`.

## Hints

A hint is a callout shown between the params of a tab. It is declared in `params` like a param, but it holds no value and never reaches `run`.

```ts
import { hint, param } from "@fluxify/sdk/blocks";

params: {
	mode: param.select({ options: ["simple", "advanced"], default: "simple" }),
	note: hint("Advanced mode sends the message as a thread.", {
		tone: "tip",
		visibleWhen: { mode: "advanced" },
	}),
},
```

`text` is markdown. `tone` is `info` (the default), `tip` or `warning`. A hint takes `tab`, `order` and `visibleWhen` like a param.

## Showing a param only sometimes

`visibleWhen` is data, not code. It names params of the same block and the values they must hold:

```ts
params: {
	mode: param.select({ options: ["simple", "advanced"], default: "simple" }),
	shape: param.schema({ visibleWhen: { mode: "advanced" } }),
	level: param.string({ visibleWhen: { mode: ["simple", "advanced"] } }),
	both: param.string({
		visibleWhen: { all: [{ mode: "advanced" }, { level: "high" }] },
	}),
},
```

| Form | Shown when |
| :--- | :--- |
| `{ mode: "advanced" }` | `mode` is `advanced` |
| `{ mode: ["a", "b"] }` | `mode` is `a` or `b` |
| `{ a: 1, b: 2 }` | Every key matches |
| `{ all: [...] }` | Every condition inside matches |
| `{ any: [...] }` | At least one matches |

You can compare `select`, `string`, `number` and `boolean` params, and TypeScript and the build both check that the name and value exist. `all` and `any` are reserved words, so no param can be called that.

## Tabs and order

A block with many params can split them across tabs:

```ts
tabs: ["General", "Advanced"],
params: {
	text: param.string({ required: true, order: 1 }),
	channel: param.string({ order: 0 }),
	timeout: param.number({ tab: "Advanced" }),
},
```

- **General** comes first unless `tabs` places it, then the tabs in `tabs`, then any other tab in order of first use.
- Within a tab, params with an `order` come first, lowest first, and the rest follow in declaration order.
- A tab with no param in it is a build error. A tab whose params are all hidden by `visibleWhen` disappears from the panel. A block with a single tab shows no tab bar.
- `tab` and `order` change only how the panel looks. `run` never sees them.

## Names you cannot use

These keys belong to Fluxify on every block: `blockName`, `blockDescription`, `invoke`, `saveAsVariable`, `order`. `all` and `any` are reserved for `visibleWhen`. Declaring a param with one of these names fails the build.

## Deprecating a param

Wrap a param in `deprecated(...)` when you plan to remove it. It keeps working. The settings panel shows your message beside it.

```ts
import { deprecated, param } from "@fluxify/sdk/blocks";

params: {
	channel: param.string({ required: true }),
	legacy: deprecated(param.string(), "Ignored since Oct 2026, removed in the Jan 2027 release; use `channel`."),
},
```
