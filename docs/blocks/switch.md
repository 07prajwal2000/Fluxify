---
title: Switch
description: Send the flow down one of several paths, picked by conditions checked in order, with an optional default path.
---

# Switch

The **Switch** block picks one path out of many. Every block connected to its **Cases** handle is one case. The cases are checked from top to bottom, and the first one that matches runs. You can also pick one case as the **default**, which runs when no other case matches.

## Inputs

- **Cases** (right handle): connect the first block of each path. You can connect as many as you like. Each new connection adds a case to the list.
- **Cases tab**: one row per case, showing the connected block and its condition.
  - Drag the rows (or use the arrows) to change the order the cases are checked in. Hovering a row highlights its connection on the canvas.
  - The **×** button disconnects that case.
  - The last row is the **Default** slot. See [The default case](#the-default-case).
- **Condition**: either a plain value or JavaScript.
  - **Plain value** (JS off): the case runs when the Switch block's input is exactly equal to it. See [Plain values](#plain-values).
  - **JS** on: write JavaScript that `return`s a value. The case runs when the value is truthy. The Switch block's input is available as `input`.
- **Switch on a value** (General tab): instead of a condition per case, write one script that returns the value to switch on, and give each case the value it matches. See [Switching on a value](#switching-on-a-value).

## Logic

1. The cases are checked one at a time, from the top of the list down.
2. The first case that matches runs, and it receives the Switch block's input.
3. Every case below it is skipped. Their conditions are not run at all.
4. If no case matches, the default case runs.
5. If there is no default case, the flow stops at the Switch block.

## Output

The Switch block does not change the data. It passes its input straight through, the same way the If Condition block does.

- The case that runs (including the default) receives exactly what the Switch block received.
- When nothing runs, the flow ends and its result is the Switch block's input.
- With **Switch on a value**, the value script's result is only used to pick the case. It is not passed on.

Because the block makes no new output, it has no **Save output to variable** option.

## Plain values {#plain-values}

With **JS** off, a condition is a plain value. The case runs when the Switch block's input is **strictly equal** (`===`) to it, so the type of the input matters.

Numbers and `true`/`false` are turned into a real number or boolean when the flow is saved, not left as text. Everything else stays text. Spaces around the value are ignored.

| Condition (plain) | Is treated as | Matches input `404` | Matches input `"404"` |
|---|---|---|---|
| `404` | the number `404` | yes | no |
| `true` | the boolean `true` | no | no |
| `paid` | the text `"paid"` | no | no |

More examples:

| Input | Condition | Runs? |
|---|---|---|
| `"paid"` | `paid` | yes |
| `"paid"` | `Paid` | no, the match is exact |
| `true` | `true` | yes |
| `"true"` (text) | `true` | no, the condition is a boolean |
| `0` | `false` | no, `0` is not `false` |
| `{ "status": "paid" }` | `paid` | no, the whole input is compared |

::: info Only literal values are matched
A plain value is never read as a reference or run as code. `input.status` is compared as the text `input.status`. To match part of the input, `null`, or text that looks like a number (like `"404"`), turn on **JS**, for example `return input.status === "paid";`.
:::

## JavaScript conditions

| Condition (JS) | The case runs when |
|---|---|
| `return input.status === "paid";` | the input's `status` is `"paid"` |
| `return input.total > 100;` | the input's `total` is more than 100 |
| `return input.items.length === 0;` | the input has an empty `items` list |

::: warning JavaScript conditions need `return`
A condition must `return` its result. Writing only `input.total > 100` returns nothing, so that case never runs. Write `return input.total > 100;` instead.
:::

## The default case {#the-default-case}

The last row of the Cases list is the **Default** slot.

- **Make a case the default:** drag it onto the Default slot, or press the down arrow on the last case.
- **Undo it:** press the up arrow on the default, or drag it back into the list. It becomes a normal case again, with its old condition.
- **Replace it:** drag another case onto the slot. The old default goes back to the end of the list.

The default case needs no condition. It runs only when no case above it matches, so the result is always predictable. A Switch has at most one default case.

::: warning No default case
Without a default case, when no case matches, the flow stops at the Switch block and returns its input. The Cases tab and the canvas both warn about this.
:::

## Switching on a value {#switching-on-a-value}

Turn on **Switch on a value** in the General tab when every case compares the same thing, like a status or a type.

1. Write a **Value script** that returns the value to check, for example `return input.status;`. It runs once.
2. Give each case a **match value**. The first case whose match value is strictly equal (`===`) to the script's result runs. Match values follow the same rules as [plain values](#plain-values): numbers and `true`/`false` get their real type, everything else is text.
3. If none match, the default case runs.
4. The case still receives the Switch block's input, not the value.

| Value script returns | Case match value | Runs? |
|---|---|---|
| `"paid"` | `paid` | yes |
| `"paid"` | `Paid` | no, the match is exact |
| `"paid"` | `input.status` | no, this is the text `input.status`, not a reference |
| `404` (a number) | `404` | yes, `404` becomes a number |
| `"404"` (text) | `404` | no, the types differ |
| `"404"` (text) | JS: `return "404";` | yes |
| `true` | `true` | yes |
| `null` | JS: `return null;` | yes |


A case with an empty match value never runs. Your conditions and match values are kept separately, so turning the toggle off and on again loses nothing.

## Warnings on the canvas

The Switch block shows a warning in **Diagnostics** when:

- no cases are connected,
- there is no default case,
- a case has an empty condition or match value,
- **Switch on a value** is on but the value script is empty.

::: info When a condition fails
If a condition or the value script throws an error, the Switch block fails and the error handler runs. No case runs.
:::

::: info Connecting one block twice
Conditions belong to the connected block. Two cases that lead to the same block share one condition, so connect each case to its own block.
:::
