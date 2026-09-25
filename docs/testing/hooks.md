---
title: Hooks
description: Change what a block receives or returns during a test, or skip it and use made-up data, so you can test one route without real databases or services.
---

# Hooks

A **hook** is a small piece of code, attached to one block of the route, that runs only while a test suite runs. It lets you:

- **skip a block** and give it a made-up result, for example skip a database call and pretend it returned a user;
- **change what a block receives**, to steer the route down a certain path;
- **change what a block returns**, to try an unusual case with real data;
- **check values in the middle** of the route with `t.expect`;
- **make a block fail**, to test your error handler.

Hooks never affect the live route. They exist only inside the suite they belong to.

## Add a hook

1. Open the suite and choose the **Hooks** tab.
2. On the left, pick a block. Only blocks that can have hooks are listed.
3. Choose **Before** (runs just before the block) or **After** (runs just after it).
4. Choose **Script** to write JavaScript, or **JSON** to type a made-up result. **Off** removes the hook.
5. Press **Save**.

Blocks with a hook show a dot in the list. Switching between Off, Script and JSON keeps what you typed until you leave the page; only the choice selected when you press **Save** is stored.

## Before

A **Before** hook runs just before the block. `input` is the value about to go into the block.

| What your code does | What happens |
| --- | --- |
| Returns nothing | The block runs as normal |
| Returns a value | The block runs with **that value** as its input |
| Calls `t.skip(output)` | The block does **not** run; `output` is passed on as if the block had returned it |
| Throws an error, or calls `t.fail("message")` | The block fails, and the route's error handler runs |

```js
// change the input
return { ...input, email: input.email.toLowerCase() };
```

```js
// skip the database call and pretend it found this user
t.skip({ id: 7, name: "Test user" });
```

### The JSON shortcut

Choosing **JSON** for a Before hook is the same as calling `t.skip` with that JSON: the block is skipped and the JSON is passed on as its result. It is the quickest way to fake a block:

```json
{ "id": 7, "name": "Test user" }
```

### Skipping a block that has two paths

Some blocks send their result down one of two paths, such as **Row Exists** (found / not found) or **Database Transaction** (success / failure). Pick the path as the second argument of `t.skip`:

```js
// pretend the row exists
t.skip({ id: 7 }, "success");

// pretend it does not
t.skip(null, "failure");
```

Without a path, the first one (`"success"`) is used. The editor lists the paths each block has.

## After

An **After** hook runs just after the block. It gets `input` (what the block ran with) and `output` (what it returned).

| What your code does | What happens |
| --- | --- |
| Returns nothing | The output is passed on unchanged |
| Returns a value | **That value** is passed on instead |
| Throws an error, or calls `t.fail("message")` | The block fails, and the route's error handler runs |

```js
// check the real result, then force an edge case
t.expect(output).toHaveLength(2);
return [];
```

A JSON After hook replaces the output with that JSON.

If a Before hook skipped the block, its After hook does not run.

## What `t` gives you

| Name | What it does |
| --- | --- |
| `t.skip(output, path?)` | Before only: skip the block and pass `output` on (down `path`, if the block has two) |
| `t.fail(message)` | Make the block fail with this message |
| `t.expect(value)` | Check a value; each check is a line in the results ([all checks](./checks#t-expect-checks)) |
| `t.call` | How many times this block has run so far in this suite: `1`, `2`, `3`… Useful in loops |
| `t.vars` | The route's variables, to read or change |
| `t.block` | This block's `id`, `type` and `name` |
| `t.setup` | What the suite's [setup block](./setup-and-teardown) returned |
| `t.runId` | A value unique to this suite run |
| `t.zod` | The [zod](https://zod.dev) library, to check the shape of a value |

`t.expect` lines from hooks appear in the results first, labelled with the block, for example:

```text
✗ db_getall "Load users": expected 1 to be 2
```

## Values from earlier blocks

`input` is only the value from the block just before. To read what an earlier block produced, use `t.vars`:

- `t.vars.outputs.<name>`: the result of any block that has **Save output to variable** turned on, under that name.
- `t.vars.<key>`: anything stored with a **Set Var** block.

## Which blocks can have hooks

| Blocks | Allowed |
| --- | --- |
| Entrypoint, Response, Error Handler, sticky notes | No hooks: they are the frame of the route, not steps in it |
| If, Switch, For Loop, Foreach Loop, Orchestrator | **Before** script only, to change the input. They run other blocks, so they cannot be skipped |
| Every other block, including custom blocks | Before and After, Script or JSON |

A custom block placed on the route is hooked as a whole: you can skip or change the whole custom block, but not the blocks inside it.

## Examples

**Test the "not found" path without a database**

On the **Row Exists** block, Before, Script:

```js
t.skip(null, "failure");
```

Then check the status in Assertions: Status code equals `404`.

**A different result on each pass of a loop**

On a **Get Single Record** block inside a loop, Before, Script:

```js
// first pass: nothing found; after that: a row
t.skip(t.call === 1 ? null : { id: t.call });
```

**Check what a block was given**

On any block, Before, Script:

```js
t.expect(input.userId, "user id sent to payments").toBe(42);
```

::: tip Hooks follow the canvas
A hook belongs to one block. If you delete that block from the canvas, its hooks are deleted too.
:::
