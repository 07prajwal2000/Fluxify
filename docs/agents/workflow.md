---
title: Workflow reference for agents
description: Fields, defaults, limits, errors and JSON examples for creating and updating a background workflow with save_workflow.
---

# Workflow reference for agents

A workflow is a background job. It has a canvas like a route, but no URL, no method and no response. A [trigger](/agents/trigger) starts it. For background, see [Workflows](/concepts/workflows).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_workflows` | viewer | Workflows of a project: id, name, description, active. Args: `projectId`, `page`, `search`. |
| `get_workflow` | viewer | Settings of one workflow. Not the canvas. |
| `save_workflow` | creator | Create (no `workflowId`) or update (`workflowId`). |
| `delete_workflow` | creator | Deletes the workflow and its canvas. Triggers that started it start nothing. |
| `get_canvas`, `edit_canvas` | viewer, creator | Read and change the blocks. `kind` is `"workflow"`. |

There is no tool to run a workflow by hand. Start it with a trigger, or test it with a [test suite](/agents/test-suite).

## Create a workflow

Pass `projectId` and `name`.

```json
{
  "projectId": "<project id>",
  "name": "Nightly report",
  "description": "Builds the daily sales report",
  "timeoutSeconds": 600,
  "active": true
}
```

The result is `{ "id": "<workflow id>" }`.

A new workflow starts with an entrypoint block and an error handler block, and nothing else. Add the rest with `edit_canvas`.

A block text input is a literal unless it starts with `js:`, and `js:` code must `return` the value. See [Dynamic values and `js:` expressions](/agents/expressions) before you fill a block field.

A new workflow is **inactive**. An inactive workflow is not given to the workers, so no trigger can start it. Pass `active: true` once its canvas is ready.

## Update a workflow

Pass `workflowId` and only the fields that change.

```json
{ "workflowId": "<workflow id>", "active": true }
```

`projectId` cannot change.

## Fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Create only. | none |
| `name` | string | 2 to 255 characters. Unique in the project. | none |
| `description` | string | Up to 2000 characters. | none |
| `timeoutSeconds` | integer | From 30 to 3600. | `300` |
| `active` | boolean | Only active workflows can be started. | `false` |
| `tracingEnabled` | boolean | Sends spans to the project's own telemetry destination. | `false` |
| `recordExecution` | boolean | Keeps a debug recording of each run. Read it with `list_recordings`. | `false` |

## What a workflow receives

A trigger hands the workflow a list of events. Inside the canvas:

| Name | What it holds |
| --- | --- |
| `input` | One event: the event's payload. Several events: a list of payloads. |
| `trigger.data` | Always a list. Each entry is `{ "data": <payload>, "meta": {...} }`. |
| `trigger.meta.size` | How many events this run has. |

A schedule trigger has no event. Its run gets the trigger's `payload`, or nothing when none is set. Nothing validates the input, so check it in the blocks.

## What a workflow returns

Nothing. A response block ends the run like any other last block, with no status code. Do not build one for the caller.

## When a run fails

There is nobody to report to, so a failed run is retried a few times with a pause. Make the work safe to run twice. Charging a card or sending an email needs a guard.

A workflow that runs longer than `timeoutSeconds` is stopped.

## Workflow or route

Use a route when something waits for the answer. Use a workflow for work you start and leave. A workflow can also be started from another canvas with the `trigger_workflow` block. `get_block_schemas` does not list that block, so read its fields in [Trigger Workflow](/blocks/trigger-workflow).

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Fluxify API error 409: workflow with that name already exists` | Another workflow in the project has this name. |
| `Invalid input: timeoutSeconds: ...` | The value is outside 30 to 3600. |
| `Invalid input: name: ...` | The name is shorter than 2 or longer than 255 characters. |
| `Not found: Workflow not found` | Wrong `workflowId`. Use `list_workflows`. |
| `Not found: project with id ... does not exist` | Wrong `projectId`. Use `list_projects`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |

Nothing runs when the trigger is off, has no workflow, or the workflow is inactive. All three must be right. After a change, check `get_system_logs` for compile errors.
