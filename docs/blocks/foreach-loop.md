---
title: For Each Loop
description: Run the same blocks once for every item in a list.
---

# For Each Loop

The **For Each Loop** block takes a list and runs a chain of blocks once for each item in it, in order.

## Inputs

- **Use Param**: When ticked, the loop goes over the output of the previous block (it must be a list). When off, it goes over the items you type in the **Data** tab.
- **Array Items** (Data tab): The fixed list of items to loop over. Only shown when **Use Param** is off.
- **Executor**: Connect the block (or chain of blocks) to run for each item.

## Logic

1. The block picks its list: the previous block's output, or your **Array Items**.
2. For every item, from first to last, it runs the blocks connected to **Executor**. The current item is their input.
3. When the last item is done, the flow continues from the block's normal output.

::: tip
Need to count instead, like "run 10 times"? Use the [For Loop](./for-loop.md) block.
:::

::: info
The loop itself does not return anything. To collect results, save them in a variable with [Set Variable](./set-var.md) inside the loop.
:::
