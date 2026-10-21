---
title: Handles
description: The inputs, outputs and nested-chain handles of a plugin block, how executeHandle runs a chain (one branch, several in parallel, late calls), and which invoke modes can combine with which handles.
---

# Handles

Handles are the connection points of a block on the canvas. You declare them in `handles`:

```ts
import { block, handle } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/slack/messages/post",
	label: "Post message",
	handles: {
		in: [handle.in("target")],
		out: [handle.out("success"), handle.out("failure")],
		body: [handle.body("tools", "bottom-left", { allowMultiple: true })],
	},
	async run() {},
});
```

Leave `handles` out and the block gets one input, `target`, and one output, `source`.

## Inputs

`in` lists the input handles by name. The default is `[handle.in("target")]`, the usual single input on the left.

## Outputs

`out` is one of exactly three shapes. Fluxify's flow is deterministic, so a block cannot invent others:

| `out` | Shape | A canvas can |
| :--- | :--- | :--- |
| `[]` | **Terminal** | Not connect anything after it. The chain ends here |
| `[handle.out("source")]` | **One way on** (the default) | Connect one next block |
| `[handle.out("success"), handle.out("failure")]` | **Branch** | Connect one block for each outcome |

`run` picks the handle with `{ handle: "failure" }`, and the default is the first. A throw takes `failure` when the block has it ([errors](./blocks#errors)). A terminal block has no handle to return.

## Body handles

A body handle starts a **nested chain**: blocks the user draws below or above your block that your code runs when it chooses. Loops and retries are built this way. You name it, place it on a corner, and run it with `executeHandle`:

```ts
body: [
	handle.body("tools", "bottom-left", { allowMultiple: true }),
	handle.body("each", "top-left"),
],
```

| Corner | Where it sits |
| :--- | :--- |
| `top-left`, `bottom-left` | Above or below the block's icon, on the left |
| `top-right`, `bottom-right` | The same, on the right |

Several handles on one corner stack. Names are plain identifiers (letters, digits and `_`, not starting with a digit) and must be unique across the block's inputs, outputs and body handles.

A body handle takes one edge, unless `allowMultiple` is set: then the user can wire several, and each is its own **branch**.

::: info
A chain on a body handle cannot contain a block that ends the whole route (a Response block, or a Rollback outside a transaction the chain itself opens). The route is refused at compile time, because there would be nothing to give back to your code.
:::

## executeHandle

`executeHandle` runs the chain wired to a body handle and resolves to **the value the chain ended with**, the same as the built-in loops and retry. **Always `await` it:** the build warns about a call that is not awaited, because its result and errors would be lost.

| Call | Handle kind | Resolves to |
| :--- | :--- | :--- |
| `await executeHandle("each", input)` | Single | The chain's value, or `undefined` when nothing is wired |
| `await executeHandle("tools", input)` | `allowMultiple` | An array: one result per branch, run in parallel, in canvas order. `[]` when nothing is wired |
| `await executeHandle("tools", input, { branch })` | `allowMultiple` | The result of that one branch |
| `executeHandle.branches("tools")` | `allowMultiple` | `[{ id, label }]`, the wired branches in canvas order |

The first block of the chain receives `input` as its input. TypeScript only lets you pass `{ branch }` to an `allowMultiple` handle, and only offers the handle names you declared.

### Several branches at once

Branches run in parallel. A branch that fails does not stop the others: its slot holds `{ error }` and the rest hold their values.

```ts
// source: examples/plugins/agent-tools/src/blocks/agent.ts
// every Tool block wired to `tools`, in parallel; a branch that failed is `{ error }`
const tools: Tool[] = [];
for (const found of await executeHandle("tools")) {
	if (isTool(found)) tools.push(found);
	else ctx.vars.logger.logWarn(`a tool block failed and was skipped: ${JSON.stringify(found)}`);
}
```

### One branch

`branches()` tells you what is wired, so the block can pick. A branch is named by its `id` or its `label` (the block's name on the canvas, or its type if it has none).

```ts
const [first] = executeHandle.branches("tools"); // { id, label }
const result = await executeHandle("tools", { q: 1 }, { branch: first.label });
```

A `branch` that matches nothing throws an error that names the handle.

### Calling after `run` returned

`executeHandle` stays usable after your `run` returns, until the **outermost run ends**: the route's whole run, including the blocks after yours. That is what lets a block hand out a function that runs a chain later, like the Tool block in the [example plugin](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools), whose output is `{ name, call }` and whose `call` runs its chain when the Agent decides to:

```ts
// source: examples/plugins/agent-tools/src/blocks/tool.ts
async run({ params, executeHandle }) {
	return {
		output: {
			// runs after this `run` returned, while the agent's run is still going
			call: (args: unknown) => executeHandle("execute", args),
		},
	};
},
```

Spans and trace entries of a late call are recorded under the block that owns the handle. A call after the run has ended throws `executeHandle('<name>') called after the run ended`. Do not keep `executeHandle` in a variable that outlives the run.

::: warning
A client from `ctx.pool` must not be used from a late call, because the late call holds no lease on it. Call `ctx.pool` again inside the late call. See [context](./context#ctx-pool).
:::

## Invoke modes

A block's [`invoke`](./blocks#invoke) lists the ways a canvas may call it. Two things about handles limit it:

- **Only a `sync` call has a run to hand `executeHandle` to.** A block with body handles must allow `sync`, and a canvas can only call it any other way while nothing is wired to its body handles.
- **A caller of an `async` or `queued` block never learns the outcome**, so there is no branch to take. A block with `[success, failure]` outputs can only be `sync`.

| Combination | Result |
| :--- | :--- |
| `[success, failure]` outputs with `async` or `queued` in `invoke` | Refused by the build and by the block's own check |
| Body handles with `sync` missing from `invoke` | Refused by the build |
| A canvas picks a mode that is not in `invoke` | Refused by the route's compile, whoever saved the route: the portal, the API or the AI agent |
| `async` or `queued` while a body handle has a chain wired | Refused by the route's compile |
| A terminal block (`out: []`) with an edge leaving it | Refused by the route's compile |

A block whose output holds functions, like the Tool block, declares `invoke: ["sync"]`: `async` and `queued` pass their data as JSON, and a function cannot be sent.

## Deprecating a handle

Wrap a handle in `deprecated(...)` when you plan to remove it:

```ts
import { deprecated, handle } from "@fluxify/sdk/blocks";

body: [deprecated(handle.body("tools", "bottom-left", { allowMultiple: true }), "Use `skills`.")],
```

It keeps working, and the portal shows your message on the handle. Removing a handle that a route has wired blocks an [upgrade](./publishing#what-blocks-an-upgrade).
