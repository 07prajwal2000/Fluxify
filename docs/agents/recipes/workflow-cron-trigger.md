---
title: Recipe - workflow with a cron trigger
description: Step by step tool calls that create a background workflow and a cron schedule trigger that starts it every night.
---

# Recipe - workflow with a cron trigger

Goal: a workflow that runs every day at 02:30 UTC. Fields and rules are in the [Workflow reference](/agents/workflow) and the [Trigger reference](/agents/trigger).

Three things must all be on before anything runs: the trigger is active, it has a workflow, and the workflow is active. Create them in this order so the schedule never starts a half-built workflow.

## 1. Create the workflow, inactive

Call `save_workflow`:

```json
{
  "projectId": "<project id>",
  "name": "Nightly report",
  "description": "Builds the daily report",
  "timeoutSeconds": 600
}
```

It answers `{ "id": "<workflow id>" }`. The default timeout is 300 seconds. The most you can set is 3600.

## 2. Build its canvas

Call `get_canvas`:

```json
{ "target": { "kind": "workflow", "id": "<workflow id>" } }
```

A new workflow has an `entrypoint` and an `error_handler` and no edges. Note the entrypoint id and the `version`.

Call `edit_canvas`:

```json
{
  "target": { "kind": "workflow", "id": "<workflow id>" },
  "version": 0,
  "validate": true,
  "ops": [
    { "op": "add_block", "ref": "report", "type": "jsrunner",
      "data": { "value": "return { ranAt: new Date().toISOString() };" },
      "connect_from": { "from": "<entry id>" } },
    { "op": "add_block", "ref": "log", "type": "consolelog",
      "data": { "message": "Nightly report ran", "level": "info" },
      "connect_from": { "from": "report" } }
  ]
}
```

A workflow has no caller, so it needs no `response` block. For the shape of other blocks use `get_block_schemas` with `blockTypes`.

## 3. Switch the workflow on

Call `save_workflow`:

```json
{ "workflowId": "<workflow id>", "active": true }
```

An inactive workflow is not given to the workers, so no trigger can start it.

## 4. Create the schedule trigger

Call `save_trigger`:

```json
{
  "projectId": "<project id>",
  "name": "Nightly report at 02:30",
  "type": "schedule",
  "schedule": "0 30 2 * * *",
  "timezone": "UTC",
  "workflowId": "<workflow id>",
  "active": true
}
```

It answers `{ "id": "<trigger id>", "warnings": [] }`.

The schedule has **six** fields: seconds, minutes, hours, day of month, month, day of week. `0 30 2 * * *` is second 0, minute 30, hour 2, every day. Five fields are refused.

| Want | Write |
| --- | --- |
| Every 15 minutes | `0 */15 * * * *` or `@every 15m` |
| Weekdays at 09:00 | `0 0 9 * * 1-5` |
| Every day at midnight | `0 0 0 * * *` |
| Once | `@at 2026-12-31T23:00:00Z` |

Runs are spread over the minute unless you name the second. `@daily` can run at `00:00:37`. Use `UTC` for a run that must happen exactly once a day, since a timezone with daylight saving can skip or repeat a run twice a year.

## 5. Check it

Call `list_triggers`:

```json
{ "projectId": "<project id>", "workflowId": "<workflow id>" }
```

Expect `active: true`, the workflow listed, and `disabledReason: null`.

## 6. Watch the first run

To avoid waiting until 02:30, point the trigger at a short interval and record the runs:

Call `save_workflow`:

```json
{ "workflowId": "<workflow id>", "recordExecution": true }
```

Call `save_trigger`:

```json
{ "triggerId": "<trigger id>", "schedule": "@every 1m" }
```

After two minutes:

Call `list_recordings`:

```json
{ "projectId": "<project id>", "kind": "workflow", "targetId": "<workflow id>" }
```

Read a run with `get_recording` (see [Recipe, debug and fix a route or workflow](/agents/recipes/debug-and-fix)). When it works, put the real schedule back and turn recording off:

Call `save_trigger`:

```json
{ "triggerId": "<trigger id>", "schedule": "0 30 2 * * *" }
```

Call `save_workflow`:

```json
{ "workflowId": "<workflow id>", "recordExecution": false }
```

## 7. Test the workflow itself

A test suite runs the workflow directly, with an input you choose. The schedule is not used. See [Recipe, write and run a test suite](/agents/recipes/write-and-run-test-suite).

## Good to know

- A schedule is one run each time, never a batch. Set `payload` on the trigger to hand every run the same input. Otherwise the run has none.
- A run that fails is retried a few times. Make the work safe to run twice.
- After downtime, missed runs are dropped, except `@at`.
- To pause the schedule use `save_trigger` with `active: false`. Turning it on again resumes from the next scheduled time.
- `delete_trigger` removes the schedule. The workflow stays.
- Two workflows on the same clock need two triggers.

## Common problems

| What you see | What to do |
| --- | --- |
| `Invalid input: schedule: A cron expression needs six fields...` | Add the leading seconds field. |
| `Invalid input: timezone: Use an IANA timezone name...` | Use a name such as `Asia/Kolkata`, not `+05:30`. |
| `Fluxify API error 409: trigger with that name already exists` | Pick another trigger name. |
| Nothing runs | Trigger off, no workflow attached, or the workflow is inactive. Check `list_triggers` and `get_workflow`. |
| `disabledReason` is set | The system switched the trigger off. Fix the cause, then save with `active: true`. |
| Runs fail at once | Look at `get_system_logs` for compile errors, then at the recording. |
