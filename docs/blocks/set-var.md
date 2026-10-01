---
title: Set Variable
description: Save a value under a name so later blocks can read it.
---

# Set Variable

The **Set Variable** block saves a value under a name of your choice. Later blocks, including JS code, can read it by that name, even after other blocks have changed the flowing data.

## When to use it

- Keep a value you will need again later, like the logged-in user or a total.
- Hold on to the data before a block that replaces it, like [Get HTTP Header](./get-http-header.md) or [HTTP Request](./http-request.md).
- Collect results inside a loop, such as adding each round's result to a list.
- Don't use it to store data between requests. Variables disappear when the request ends. Use a database or [KV Operations](./kv-operations.md) for that.
- Don't use it to store secrets or settings. Use [App Config](../concepts/app-config.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Mode** | No | Single | **Single** handles one value. **Multiple** handles a list of rows, see below. |
| **Key** | Yes | none | The name of the variable, for example `total`. Use letters, digits, `_` or `$`, and don't start with a digit, so scripts can read it by name. |
| **Value** | Yes | none | What to store. A number, `true` or `false`, text, an object, or a JS expression such as `js: input.price * 2`. |

Start a value with `js:` to calculate it. The previous block's output is available as `input`. Anything else is stored exactly as typed.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the value you just stored. |

## Example

The previous block returned `{ "price": 40, "qty": 3 }`. Save the order total.

| Field | Value |
| --- | --- |
| Key | `total` |
| Value | `js: input.price * input.qty` |

`total` is now `120`, and the next block receives `120` as its `input`. Any later block can read it with [Get Variable](./get-var.md), or in JS simply as `total`.

## Single or Multiple

Pick **Multiple** to set several variables in one block. Each row has a **Key** and a **Value**, the same fields as Single mode.

- Rows run from top to bottom. A later row can read a variable an earlier row set.
- `input` is the previous block's output for every row.
- The output is an **array** with one value per row, in row order.
- The same key can't be used twice in one block. The canvas won't save it.

| Key | Value |
| --- | --- |
| `price` | `10` |
| `total` | `js:return price * 2;` |

The next block receives `[10, 20]`.

## How it behaves

- **Only for this request.** Each request has its own variables. Two users never see each other's values, and the variables are gone once the response is sent.
- **Setting a name again overwrites it.** The newest value wins.
- **It replaces the flowing data.** The next block's `input` is the stored value, not what came before.
- **JS can read and write them too.** A variable set here is a plain name in any JS code, and a name you assign in JS without `const` or `let` can be read with [Get Variable](./get-var.md).
- **Shared by branches.** Blocks running in parallel in an [Orchestrator](./orchestrator.md) share the same variables, so two branches writing the same name race each other.
- **Don't reuse built-in names** such as `input`, `logger` or `jwt`.

## Related blocks

- [Get Variable](./get-var.md): read the value back.
- [Array Operations](./array-operations.md): add to or filter a list kept in a variable.
- [For Each Loop](./foreach-loop.md): collect results across rounds.
- [JS Runner](./js-runner.md): read and write variables in code.
