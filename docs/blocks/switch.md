---
title: Switch
description: Send the flow down one of several paths, picked by conditions checked in order.
---

# Switch

The **Switch** block picks one path out of many. Every block connected to its **Cases** handle is one case, and each case has its own condition. The cases are checked from top to bottom, and the first one whose condition is true runs.

## Inputs

- **Cases** (right handle): connect the first block of each path. You can connect as many as you like. Each new connection adds a case at the bottom of the list.
- **Cases tab**: one row per case, showing the connected block and its condition.
  - Drag the rows (or use the arrows) to change the order the cases are checked in. Hovering a row highlights its connection on the canvas.
  - The **×** button disconnects that case.
- **Condition**: works like any other text field.
  - Type `true` to always run the case, or `false` to never run it.
  - Turn on **JS** to write JavaScript that `return`s a value. The case runs when the value is truthy. The Switch block's input is available as `input`.
- **Switch on a value** (General tab): instead of a condition per case, write one script that returns the value to switch on, and give each case the value it matches. See [Switching on a value](#switching-on-a-value).

## Logic

1. The conditions are checked one at a time, from the top of the list down.
2. The first case whose condition is true runs, and it receives the Switch block's input.
3. Every case below it is skipped. Their conditions are not run at all.
4. If no case matches, the flow stops at the Switch block.

## Output

The Switch block does not change the data. It passes its input straight through, the same way the If Condition block does.

- When a case matches, that case's first block receives exactly what the Switch block received.
- When no case matches, the flow ends and its result is the Switch block's input.
- With **Switch on a value**, the value script's result is only used to pick the case. It is not passed on.

Because the block makes no new output, it has no **Save output to variable** option.

### Examples

| Condition | The case runs when |
|---|---|
| `true` | always, so put it last to catch everything the cases above it did not |
| `false` | never |
| JS: `return input.status === "paid";` | the input's `status` is `"paid"` |
| JS: `return input.total > 100;` | the input's `total` is more than 100 |
| JS: `return input.items.length === 0;` | the input has an empty `items` list |

::: warning Plain text is not code
Without **JS** turned on, a condition is plain text, and anything other than `false` counts as true. So `return input.total > 100;` typed as plain text always runs its case. Turn on **JS** for anything that should be worked out from the data. The canvas shows a warning when a plain-text condition is not `true` or `false`.
:::

::: warning JavaScript conditions need `return`
In JS mode, a condition must `return` its result. Writing only `input.total > 100` returns nothing, so that case never runs. Write `return input.total > 100;` instead.
:::

::: tip A default case
A case with an empty condition never runs. To add a "default" path, set its condition to `true` and drag it to the bottom of the list.
:::

## Switching on a value {#switching-on-a-value}

Turn on **Switch on a value** in the General tab when every case compares the same thing, like a status or a type.

1. Write a **Value script** that returns the value to check, for example `return input.status;`. It runs once.
2. Give each case a **match value**. The first case whose match value is exactly equal to the script's result runs.
3. The case still receives the Switch block's input, not the value.

| Value script returns | Case match value | Runs? |
|---|---|---|
| `"paid"` | `paid` | yes |
| `"paid"` | `Paid` | no, the match is exact |
| `404` (a number) | `404` | no, plain text is always text |
| `404` (a number) | JS: `return 404;` | yes |
| `true` | JS: `return true;` | yes |

::: tip Numbers and other types
A plain match value is always compared as text. To match a number, `true`/`false`, or `null`, turn on **JS** in the case field and return that value.
:::

A case with an empty match value never runs. Your conditions and match values are kept separately, so turning the toggle off and on again loses nothing.

::: tip Warnings on the canvas
The Switch block shows a warning in **Diagnostics** when a case can never run or will always run by mistake: no cases are connected, a case has an empty condition or match value, a case is set to `false`, a plain-text condition is something other than `true` or `false`, or **Switch on a value** is on with an empty value script.
:::

::: info When a condition fails
If a condition or the value script throws an error, the Switch block fails and the error handler runs. No case runs.
:::

::: info Connecting one block twice
Conditions belong to the connected block. Two cases that lead to the same block share one condition, so connect each case to its own block.
:::
