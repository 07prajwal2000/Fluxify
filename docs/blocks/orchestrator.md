---
title: Orchestrator
description: Run several chains of blocks at the same time and continue with all their results.
---

# Orchestrator

The **Orchestrator** block starts several chains of blocks at the same time, waits until all of them finish, then continues with a list of their results. Use it when steps don't depend on each other and you don't want to wait for them one by one.

## When to use it

- Call several services at once, like a user API, an orders API and a stock API, and combine the answers.
- Run independent database reads together to make a route faster.
- Don't use it when one step needs the result of another. Put those in a normal chain.
- Don't use it to go through a list of items. Use [For Each Loop](./foreach-loop.md), which runs one chain once per item.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Branches** (top handle) | No, but it does nothing without any | none | Connect the first block of each chain. Any number of connections. |
| **Branch order** | No | order of connection | Drag the branches (or use the arrows) to choose which position each chain's result takes in the list. Hovering a branch highlights its connection on the canvas. |
| **When a branch fails** | No | Stop and run the error handler | **Stop and run the error handler**: the first failure fails the block. **Finish every branch**: all branches run to the end and a failed branch leaves its error message in its slot. |
| **Save output to variable** | No | off | Store the result list in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Branches** (top) | Connect each parallel chain here. Every chain starts with the Orchestrator's input. |
| **Next** (right) | Runs after every chain has finished. It receives `[result0, result1, ...]`. |

A chain's result is the output of the last block in it.

## Example

Load a user's profile and orders at the same time. The Orchestrator received `{ "userId": 7 }`.

| Branch | Chain | Result |
| --- | --- | --- |
| 1 | [DB Get Single](./db-get-single.md) on `users` | `{ "id": 7, "name": "Avery" }` |
| 2 | [DB Get All](./db-get-all.md) on `orders` | `[{ "id": 1 }, { "id": 2 }]` |

The block after the Orchestrator receives:

```json
[{ "id": 7, "name": "Avery" }, [{ "id": 1 }, { "id": 2 }]]
```

Read them with `input[0]` and `input[1]`, or turn on **Save output to variable**.

## How it behaves

- **Everything starts together.** Each chain gets the same input. The list is in branch order, not finishing order.
- **With "Finish every branch", check each item.** A failed branch's slot holds its error message (text) instead of a result.
- **With the default, the first failure wins.** The block fails and the [Error Handler](./error-handler.md) runs.
- **No branches connected.** The next block receives an empty list.
- **Shared variables.** All branches share the same request variables. Two branches that write the same variable race each other.

::: warning Response blocks inside a branch
A branch that reaches a **Response** block ends the whole route right away with that response. The other branches are ignored. Which branch gets there first can change between requests, so avoid Response blocks inside branches unless that race is what you want.
:::

## Related blocks

- [For Each Loop](./foreach-loop.md): go through a list, one item at a time.
- [Trigger Workflow](./trigger-workflow.md): start a separate workflow without waiting for it.
- [Error Handler](./error-handler.md): choose what happens when a branch fails.
