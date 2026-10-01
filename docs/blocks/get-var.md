---
title: Get Variable
description: Read back a value that was saved earlier in the same request.
---

# Get Variable

The **Get Variable** block reads a value that you saved earlier with [Set Variable](./set-var.md) (or in JS code) and passes it to the next block.

## When to use it

- Bring back a value from earlier in the flow, like the user you looked up ten blocks ago.
- Use a value in a block that has no JS field of its own.
- Don't use it inside JS fields, where the name is already available. Write `total` instead of adding a Get Variable block.
- Don't use it to read settings or secrets. Use [App Config](../concepts/app-config.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Mode** | No | Single | **Single** handles one value. **Multiple** handles a list of rows, see below. |
| **Key** | Yes | none | The name of the variable to read, exactly as you named it. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the variable's value. |

## Example

An earlier step ran [Set Variable](./set-var.md) with Key `total` and Value `120`. Later, after other blocks changed the flowing data:

| Field | Value |
| --- | --- |
| Key | `total` |

The next block receives `120` as its `input`.

## Single or Multiple

Pick **Multiple** to read several variables in one block. Each row has a **Key**.

- The output is an **array** with one value per row, in row order.
- A variable that was never set gives `undefined` for its row. The other rows still work.

With rows `price` and `total`, the next block receives `[10, 20]`.

## How it behaves

- **A missing variable is `undefined`.** If nothing was saved under that name yet, it is not an error. The next block just gets no value, so check it with an [If Condition](./if-condition.md) when it matters.
- **Names must match exactly.** `Total` and `total` are different variables.
- **It replaces the flowing data.** The next block's `input` is the variable's value, not what came before.
- **Only this request.** Variables don't carry over from one request to the next.
- **Saved outputs are separate.** Blocks with **Save output to variable** write to `outputs.<name>`. Read them as `outputs.<name>` in JS, or get the whole `outputs` object with this block using the key `outputs`.

## Related blocks

- [Set Variable](./set-var.md): save a value.
- [If Condition](./if-condition.md): check that the value exists.
- [JS Runner](./js-runner.md): read and write variables in code.
