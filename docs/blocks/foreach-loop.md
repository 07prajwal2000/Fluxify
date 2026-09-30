---
title: For Each Loop
description: Run a chain of blocks once for every item in a list.
---

# For Each Loop

The **For Each Loop** block takes a list and runs a chain of blocks once for each item in it, from the first to the last. Each round, the chain receives the current item.

## When to use it

- Do the same thing for every item: send an email to each user, insert each order line, call an API for each id.
- Work through the list that a previous block returned, like the rows from [DB Get All](./db-get-all.md).
- Don't use it to only count rounds. Use [For Loop](./for-loop.md) for "run 10 times".
- Don't use it just to change every item. [Transformer](./transformer.md) or [Array Operations](./array-operations.md) do that without a loop.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Use Param** | No | off | On: loop over the previous block's output, which must be a list. Off: loop over the items you type in the **Data** tab. |
| **Array Items** (Data tab) | No | empty list | The fixed list to loop over. Only used when **Use Param** is off. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Body** (top) | Connect the first block of the chain to repeat. It runs once per item and receives that item as `input`. |
| **Next** (right) | Connect the block to run after the last item. |

The loop itself returns nothing. The block connected to **Next** receives an empty `input`, not the results of the rounds. To keep results, save them in a variable with [Set Variable](./set-var.md) inside the loop.

## Example

[DB Get All](./db-get-all.md) returned these users:

```json
[{ "id": 1, "email": "a@x.com" }, { "id": 2, "email": "b@x.com" }]
```

| Field | Value |
| --- | --- |
| Use Param | on |

The **Body** chain runs twice. The first time `input` is `{ "id": 1, "email": "a@x.com" }`, the second time it is `{ "id": 2, "email": "b@x.com" }`. Put an [HTTP Request](./http-request.md) in the chain to send each user a message.

## How it behaves

- **Items run one at a time, in order.** Item two starts only when item one is done.
- **An empty list is fine.** The chain never runs and the flow goes straight to **Next**.
- **Use Param needs a list.** With no output at all, the block fails. An object is skipped without any error, and text is read one letter at a time, so check that you really have a list.
- **An error stops the loop.** If a block in the chain fails, the remaining items are skipped and the [Error Handler](./error-handler.md) runs.
- **A Response ends everything.** If the chain reaches a [Response](./response.md) block, the whole route ends with that response.
- **Shared variables.** Every round sees and changes the same variables.

## Related blocks

- [For Loop](./for-loop.md): repeat a set number of times.
- [Set Variable](./set-var.md): collect results across rounds.
- [Array Operations](./array-operations.md): change or filter a list without looping.
- [Orchestrator](./orchestrator.md): run different chains at the same time.
