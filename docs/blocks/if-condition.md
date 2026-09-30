---
title: If Condition
description: Send the flow down one path when a check is true and another when it is false.
---

# If Condition

The **If Condition** block checks one or more rules and then picks a path: **Success** when the rules pass, **Failure** when they don't. Think of it as "if this, do that, otherwise do something else".

## When to use it

- Check something before you continue: is the user an admin, is the total above 100, is a field missing?
- Give two different answers: return data when it exists, return a `404` when it doesn't.
- Don't use it to pick between many options. Use [Switch](./switch.md) instead of a chain of Ifs.
- Don't use it to check whether a database row exists. [DB Row Exists](./db-row-exists.md) does that in one step.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Conditions** | No | none | The list of rules to check. Each rule has a left value, an operator and a right value. |

Each rule has:

| Part | What it does |
| --- | --- |
| **Left value** / **Right value** | What to compare. Type a plain value like `100`, or turn on **JS** to compute it, for example `return input.total;`. |
| **Operator** | `=`, `!=`, `>`, `>=`, `<`, `<=`, `Is Empty/Null`, `Is Not Empty/Null`, or `JS`. |
| **AND / OR** | How this rule joins the rules before it. |
| **Group** | Brackets. The rules inside a group are checked together first. |

- **Is Empty/Null** and **Is Not Empty/Null** only use the left value. Empty means `null`, `undefined`, `""`, or an object or list with nothing in it.
- **JS** lets you write the whole check yourself. Return `true` or `false`, for example `return input.items.length > 0;`. The previous block's output is available as `input`.

## Outputs

The If Condition block does not change your data. Whatever it received is passed to the path that runs.

| Handle | When it is used |
| --- | --- |
| **Success** (right) | The conditions are true. |
| **Failure** (right) | The conditions are false. |

Connect one block to each handle. A path you leave empty simply ends the flow there.

## Example

Reject small orders. The previous block output `{ "total": 40 }`.

| Left value | Operator | Right value |
| --- | --- | --- |
| JS: `return input.total;` | `>=` | `50` |

- `total` is `40`, so the check is false and the flow goes to **Failure**. Connect a [Response](./response.md) with code `400` there.
- With `total` at `80` it goes to **Success**, and the next block receives `{ "total": 80 }` unchanged.

## How it behaves

- **Left to right, no precedence.** `a OR b AND c` is read as `(a OR b) AND c`. Use a group when you need a different order.
- **No rules means true.** With an empty list the flow always takes **Success**. An empty group is ignored.
- **Loose equality.** `=` does not care about type, so the text `"5"` equals the number `5`. Use **JS** with `===` when the type matters.
- **Stops early.** Once the answer is clear, the remaining rules are skipped, so a rule that would throw is never run.
- **Errors.** If a JS rule throws an error, the block fails and the [Error Handler](./error-handler.md) runs. It does not fall to **Failure**.
- **Failure is not an error.** Taking the **Failure** path is a normal result, and the Error Handler does not run.
- **Saving the result.** The block has no output of its own, so it has no "Save output to variable" option.

## Related blocks

- [Switch](./switch.md): pick one of several paths.
- [DB Row Exists](./db-row-exists.md): branch on whether a record exists.
- [Response](./response.md): send a `400` or `404` from the **Failure** path.
- [Conditions and Evaluators](../concepts/evaluators.md): how conditions work in more detail.
