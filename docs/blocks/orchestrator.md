---
title: Orchestrator
description: Run several block chains at the same time and collect their outputs.
---

# Orchestrator

The **Orchestrator** block runs every chain connected to its **Branches** handle at the same time, then continues with an array of their outputs.

## Inputs

- **Branches** (top handle): connect the first block of each chain. Any number of connections.
- **Branch order**: drag the branches (or use the arrows) to choose which index each chain's output lands at. Hovering a branch highlights its connection on the canvas.
- **When a branch fails**:
  - **Stop and run the error handler** (default): the first failure fails the block, like any other failing block.
  - **Finish every branch**: all branches run to the end. A failed branch's slot in the result array holds its **error message** instead of an output, so check each item before using it.
- **Save output to variable**: store the result array in `outputs.<name>`.

## Logic

1. Every branch starts with the Orchestrator's input.
2. Each branch's result is the output of the last block in its chain.
3. When all branches finish, the next block gets `[output0, output1, ...]` in the order you set.

::: warning Response blocks inside a branch
A branch that reaches a **Response** block ends the whole route right away with that response. The other branches are ignored. Which branch gets there first can change between requests, so avoid Response blocks inside branches unless that race is what you want.
:::

::: tip Shared variables
Branches share the same request variables. Two branches writing the same variable race each other.
:::
