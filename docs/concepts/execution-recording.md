---
title: Execution Recording
description: Keep a copy of each run of a route or workflow, with every block's input, output and result, and replay it on the canvas to debug it.
---

# Execution Recording

**Recording** keeps a copy of each run of a route or workflow inside Fluxify. For every block that ran you get its input, its output, how long it took, and whether it succeeded or failed. You can then open the run and see the path it took, lit up on the canvas.

It is a **debugging tool**. Turn it on while you work on a route or chase a bug, then turn it off again.

::: warning Recorded data is not masked
Runs are saved exactly as they happened. Request headers, bodies, cookies and any secret a block read are all visible to anyone who can open the run. Don't record production traffic.
:::

## Turn it on

Recording is set per route or per workflow:

- Open the route's or workflow's **Settings** and turn on **Recording**, or
- Open **Track Execution** (see below) and press **Record**. Press **Recording · Stop** to turn it off.

The change applies right away, without pressing Save. While it is on, the canvas shows a red **Recording Active** badge.

Recording only saves runs that happen while it is on. Earlier runs were never kept.

## Recording or tracing?

Both show what a run did, but they are different features. You can use either one, or both.

| | Recording | [Tracing](./telemetry-configuration.md) |
| --- | --- | --- |
| Where the data goes | Kept in Fluxify | Sent to your own observability service |
| What you see | Each block's input and output, replayed on the canvas | Timing and failures, in your own tool |
| Meant for | Debugging a route while you build it | Watching routes in production |

## Who can see runs

You need the **Creator** role in the project to see recorded runs and to turn recording on or off. Viewers can't see them, because runs can hold secrets.

## How long runs are kept

Runs are deleted once they are older than **30 days**. The cleanup runs once a day. Whoever runs your Fluxify server can change the number of days with `RECORDING_MAX_AGE_DAYS` (see [Production](../deployments/production.md#recording-retention)).

You can also delete runs yourself at any time (see [Delete runs](#delete-runs)).

## Size limits

A run keeps at most:

| Limit | What happens past it |
| --- | --- |
| **1,000 blocks** (spans) per run | Later blocks are not saved |
| **256 KB** per run | Later blocks are not saved |
| **8 KB** per input or output | The value is cut short |

A run or value that was cut is marked **truncated**, so you know you are not seeing all of it.

## Track Execution

Open a route's or workflow's playground and choose the **Track Execution** tab. The **Executions** tab of a route or workflow shows the same view on a full page.

### The run list

The left side lists recorded runs, newest first. Each row shows:

- a ✓ or ✗ for success or failure, and the status code of a route;
- when the run started and how long it took;
- a **Test** badge if a [test suite](#test-traces) made the run.

Filter by **All runs**, **Test runs** or **Live runs**. Click a run to open it.

### The run on the canvas

The opened run is drawn on the canvas:

- Blocks that ran are lit; blocks that didn't run are dimmed.
- The connections the run followed are lit too, including the success or failure path, the branch an **If** took, the case a **Switch** picked, and the blocks a loop ran.
- A block that has been **deleted since the run** still shows, as a faded "Removed since this run" block, so the path stays complete.

Click a block to see its **input**, **output**, timing, and error if it failed. Click the **Entrypoint** block to see the whole **Request** (headers, query, params, cookies and body) for a route, or the **Trigger** (which trigger fired, and its input or events) for a workflow.

### Custom blocks

A custom block on the canvas can be opened to see the blocks inside it, as they ran. You can keep going into custom blocks inside custom blocks, at any depth. The breadcrumb at the top takes you back up.

Runs that an async custom block started on its own are listed with the run that started them.

### Delete runs

- The trash icon on a run deletes that one run.
- **Clear all** deletes every recorded run of this route or workflow.

Both are permanent.

## Test traces

Every [test suite](../testing/index.md) run is recorded, **even when Recording is off**. Each case gets its own trace.

- In the test results, **View trace** opens the run a case made. Use it to see exactly which block failed and why.
- A test trace has a **From test** link back to the suite and case that made it.
- Blocks that a [hook](../testing/hooks.md) skipped or changed carry a **Mocked** badge, so you can tell made-up values from real ones.

Test traces follow the same retention as other runs. Once deleted, the results show **Trace expired**.

## Use it from an AI agent

An agent connected through [MCP](../getting-started/ai-agents.md) can read recorded runs too, with the Creator role:

- `list_recordings` lists a route's or workflow's runs.
- `get_recording` reads one run: first a short form without inputs and outputs, then one block in full.
- `get_test_runs` gives each test case's trace id, to read with `get_recording`.

`save_route` and `save_workflow` can turn recording on with `recordExecution: true`.
