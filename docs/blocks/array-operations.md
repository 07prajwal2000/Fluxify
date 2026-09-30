---
title: Array Operations
description: Add items to, remove items from, or filter a list kept in a variable.
---

# Array Operations

The **Array Operations** block changes a list that you keep in a variable. You can add an item at the start or end, remove the first or last item, or keep only the items that match a rule.

## When to use it

- Build up a list, like adding each result inside a [For Each Loop](./foreach-loop.md).
- Keep a queue: add to the end (`push`) and take from the front (`shift`).
- Keep only the items you need, like users who are active.
- Don't use it to change the items themselves. Use [Transformer](./transformer.md) for that.
- Don't use it to loop over a list. Use [For Each Loop](./foreach-loop.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Operation** | Yes | none | What to do, see the table below. |
| **Datasource** | Yes | none | The name of the variable that holds the list. It must already exist, for example saved with [Set Variable](./set-var.md). |
| **Value** | For `push` and `unshift` | none | The item to add. A plain value, an object, or a JS expression like `js: input.id`. |
| **Use Param As Input** | No | off | On: add the previous block's output as the item, instead of **Value**. |
| **Filter Conditions** | For `filter` | none | Rules that an item must pass to be kept. Built like [If Condition](./if-condition.md) rules, and each item is available as `input`. |

| Operation | What it does |
| --- | --- |
| `push` | Adds the item to the end of the list. |
| `unshift` | Adds the item to the beginning. |
| `pop` | Removes the last item. |
| `shift` | Removes the first item. |
| `filter` | Keeps only the items that pass the **Filter Conditions**. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the **whole updated list**. |

Also, the **Save output to variable** option can store the updated list in `outputs.<name>`.

## Example

Keep only the active users in a variable called `users`, which holds:

```json
[{ "name": "Avery", "active": true }, { "name": "Kai", "active": false }]
```

| Field | Value |
| --- | --- |
| Operation | `filter` |
| Datasource | `users` |
| Filter Conditions | One rule with operator `JS`: `return input.active;` |

The variable `users` is now `[{ "name": "Avery", "active": true }]`, and the next block receives that same list.

## How it behaves

- **The variable is changed in place.** The list in the Datasource is updated, not just the output.
- **Pop and shift return the list, not the removed item.** To use the removed item, read it with [JS Runner](./js-runner.md) before you remove it.
- **The Datasource must be a list.** If the variable is missing or is not a list, the block fails with `datasource is not an array` and the [Error Handler](./error-handler.md) runs.
- **Pop or shift on an empty list does nothing.**
- **No filter rules keeps everything.** An empty condition list passes every item.
- **Filter keeps the order** of the items it keeps.

## Related blocks

- [Set Variable](./set-var.md): create the list first, for example with the value `js: []`.
- [For Each Loop](./foreach-loop.md): add something to a list on every round.
- [Transformer](./transformer.md): change the shape of each item.
- [If Condition](./if-condition.md): the same rules, used to pick a path.
