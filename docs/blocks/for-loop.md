---
title: For Loop
description: Repeat a chain of blocks a set number of times.
---

# For Loop

The **For Loop** block runs a chain of blocks again and again, counting from a start number up to an end number. Each round, the chain receives the current count.

## When to use it

- Do something a fixed number of times, like retrying a call 3 times or building 10 rows of test data.
- Work through page numbers, like pages `1` to `5` of an external API.
- Don't use it to go through a list of items. [For Each Loop](./foreach-loop.md) hands you each item directly.
- Don't use it to run things at the same time. A loop runs one round after the other. For parallel work, use [Orchestrator](./orchestrator.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Start** | Yes | none | The number to start counting from, for example `0`. |
| **End** | Yes | none | The number to stop at. The loop stops **before** reaching it. |
| **Step** | No | `1` | How much to add to the count after each round. |

Each of the three can be a plain number or a JS expression, for example `js:input.length`. A JS expression is worked out once, before the loop starts.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Body** (top) | Connect the first block of the chain to repeat. It runs once per round and receives the count as `input`. |
| **Next** (right) | Connect the block to run after the last round. |

The loop itself returns nothing. The block connected to **Next** receives an empty `input`, not the results of the rounds. To keep results, save them in a variable with [Set Variable](./set-var.md) inside the loop.

## Example

Fetch pages 1 to 3 of an external API and collect them.

| Field | Value |
| --- | --- |
| Start | `1` |
| End | `4` |
| Step | `1` |

The **Body** chain runs three times, with `input` set to `1`, then `2`, then `3`. Use it in an [HTTP Request](./http-request.md) URL like `js: 'https://api.example.com/items?page=' + input`. A [Set Variable](./set-var.md) block at the end of the chain adds each page to a list.

## How it behaves

- **The end number is not included.** `Start 0, End 3` runs with `0`, `1`, `2`. To run with `3` as well, set **End** to `4`.
- **No rounds are a normal result.** If **Start** is already at or past **End**, the chain never runs and the flow moves on to **Next**.
- **A bad step can loop forever.** A **Step** of `0`, or a negative step with a **Start** below **End**, never reaches the end. The panel warns you when it spots this.
- **Rounds run in order.** Round two starts only after round one has finished.
- **An error stops the loop.** If a block in the chain fails, the remaining rounds are skipped and the [Error Handler](./error-handler.md) runs.
- **A Response ends everything.** If the chain reaches a [Response](./response.md) block, the whole route ends with that response, even in round one.
- **Shared variables.** Every round sees and changes the same variables, so what round one sets is still there in round two.

## Related blocks

- [For Each Loop](./foreach-loop.md): repeat once per item in a list.
- [Set Variable](./set-var.md): collect results across rounds.
- [Orchestrator](./orchestrator.md): run chains in parallel instead of one after another.
