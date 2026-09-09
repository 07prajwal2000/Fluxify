---
title: Trigger Workflow
description: Start a workflow from a route or another workflow.
---

# Trigger Workflow

The **Trigger Workflow** block starts a [workflow](/concepts/workflows) and
carries on immediately. It does not wait for the workflow to finish, and it
never receives its result.

Use it when a request should kick off background work — a signup that sends a
welcome email, an order that rebuilds a report — without making the caller wait
for that work to happen.

## Inputs

| Field | What it does |
|---|---|
| **Workflow** | The workflow to start. Pick it from the list. |
| **Use incoming value** | Send the previous block's output instead of the data below. |
| **Data** | What the workflow receives. Accepts a `js:` expression. |

## Logic

1. The block works out what to send — the incoming value, or the data you set.
2. It queues a run of the chosen workflow with that data.
3. It finishes straight away, and the next block runs.

The workflow starts on a worker some moment later. It gets its own time limit,
its own retries, and its own logs.

## Size limit

The data has to be small. Each project sets the ceiling — **64 KB** by default,
**256 KB** at most — under **Project settings → General → Trigger payload
limit**.

A larger payload is refused when the block runs and the workflow is never
started, so the failure surfaces on your canvas rather than quietly disappearing.

::: tip Send a reference
Pass an id and let the workflow load the rest. If you genuinely need to move
large payloads, use a dedicated trigger with an integration built for it.
:::

## Notes

- The workflow must be **active**, or the run has nothing to run on.
- Nothing comes back. If you need the answer, the work belongs in this canvas,
  not in a workflow.
- Inside the workflow the data arrives as usual — see
  [Triggers](/concepts/triggers) for what the workflow reads.
