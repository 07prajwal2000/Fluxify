---
title: Trigger reference for agents
description: Fields, defaults, limits, errors and JSON examples for cron schedules and queue triggers created with save_trigger.
---

# Trigger reference for agents

A trigger starts one workflow. It can run on the clock (a cron or interval schedule) or when a message arrives on a queue. `save_trigger` creates and updates it. For background, see [Triggers](/concepts/triggers) and [Schedules](/concepts/schedules).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_triggers` | viewer | Triggers of a project: id, name, type, active, workflow, disabledReason. Args: `projectId`, `workflowId`, `page`, `search`. |
| `get_trigger` | viewer | Every setting of one trigger. |
| `save_trigger` | creator | Create (no `triggerId`) or update (`triggerId`). |
| `delete_trigger` | creator | Deletes the trigger. The workflow stays. Nothing starts it from this trigger again. |

## Types

| `type` | Starts the workflow | Needs |
| --- | --- | --- |
| `schedule` | On the clock. | `schedule`. Optional `timezone`. |
| `internal` | From inside Fluxify. It has no clock and no queue. | Nothing else. |
| `redis` | For each entry of a Redis stream. | A `Redis` KV integration, `source`. |
| `rabbitmq` | For each message of an existing RabbitMQ queue. | A `RabbitMQ` integration, `source`. |
| `kafka` | For each message on Kafka topics. Needs an enterprise licence. | A `Kafka` integration, `source`. |
| `nats` | For each message of a NATS JetStream stream. Needs an enterprise licence. | A `NATS` integration, `source`. |
| `sqs` | For each message of an SQS queue. Needs an enterprise licence. | An `SQS` integration, `source`. |

`get_instance_info` shows the licence. Without one, creating a `kafka`, `nats` or `sqs` trigger fails with a 403.

## Create a schedule trigger

Pass `projectId`, `name`, `type`, `schedule` and the workflow.

```json
{
  "projectId": "<project id>",
  "name": "Nightly report",
  "type": "schedule",
  "schedule": "0 30 2 * * *",
  "timezone": "UTC",
  "workflowId": "<workflow id>",
  "active": true
}
```

The result is `{ "id": "<trigger id>", "warnings": [] }`.

A new trigger is **inactive**. Pass `active: true`, or nothing runs. The workflow must also be active.

## Create a queue trigger

Pass the integration and a `source` in the connector's terms. This example reads a Redis stream.

```json
{
  "projectId": "<project id>",
  "name": "Orders stream",
  "type": "redis",
  "integrationId": "<Redis integration id>",
  "source": { "stream": "orders" },
  "workflowId": "<workflow id>",
  "batchSize": 10,
  "maxWaitMs": 2000,
  "active": true
}
```

On create, on enabling, and on any change to `source` or `integrationId`, Fluxify contacts the broker. It checks the credentials and that the topic, stream or queue exists. A failure is a 400 with the broker's message and nothing is saved.

`warnings` lists settings that work but need a look, for example a missing dead-letter queue. Read them.

## Update a trigger

Pass `triggerId` and only the fields that change.

```json
{ "triggerId": "<trigger id>", "active": false }
```

- `type` and `projectId` cannot change. If you pass them they are ignored.
- `workflowId: null` detaches the workflow. The trigger then idles.
- Turning a trigger on clears its `disabledReason`. The system sets that field when it switches a trigger off itself, for example when its queue was deleted.

## Common fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Create only. | none |
| `name` | string | 2 to 255 characters. Unique in the project. | none |
| `description` | string | Up to 2000 characters. | none |
| `type` | string | One of the types above. Create only. | none |
| `workflowId` | string or null | A workflow of the same project. May be left out: the trigger is then saved and idle. | none |
| `groupId` | string | A trigger group of the same project. Leave it out for the default group. | default group |
| `integrationId` | string | Queue types only. An integration of the right kind in this project. Never for `schedule` or `internal`. | none |
| `payload` | any JSON | Static data handed to the workflow. Use it for sources that carry none. | none |
| `active` | boolean | Only active triggers run. | `false` |

A group holds at most 5 triggers by default. The operator can change that. The 6th fails with `A trigger group holds at most 5 triggers and this one has 5. Create another group for the rest.` No tool creates groups, so ask a person.

## Schedule fields

| Field | Rule | Default |
| --- | --- | --- |
| `schedule` | Required for `schedule`. Up to 255 characters. Not allowed on other types. | none |
| `timezone` | An IANA name such as `Asia/Kolkata`. A fixed offset such as `+05:30` is refused. Up to 64 characters. | `UTC` |

### Ways to write a schedule

| You write | It runs |
| --- | --- |
| `@every 5m` | Every 5 minutes from when it was saved. The shortest is `1s`. Units: `ns`, `us`, `ms`, `s`, `m`, `h`. Parts can be joined, as in `1h30m`. |
| `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`, `@annually` | At the start of the hour, day, week (Sunday), month or year. |
| `0 0 9 * * 1-5` | Six-field cron: **seconds** first, then minute, hour, day of month, month, day of week. Weekdays at 09:00. |
| `@at 2026-03-01T02:00:00Z` | Once. A time already past never runs. |

Five-field cron is refused: `A cron expression needs six fields — seconds, minutes, hours, day of month, month, day of week. Got 5.` Add a leading `0`.

### Behaviour

- `@every` and `@at` ignore `timezone`.
- A timezone with daylight saving can skip a run or run twice on the change days. Use `UTC` when a run must happen exactly once.
- Runs are spread over the minute. `@daily` may run at `00:00:37`, and it uses that second every day. Name the seconds field in cron to pin it.
- A schedule is one run each time, never a batch. The batch settings below do not apply.
- After downtime, missed runs are dropped, not replayed. Only `@at` runs late.

## Batch and retry fields

These apply to queue triggers.

| Field | Rule | Default | Meaning |
| --- | --- | --- | --- |
| `batchSize` | 1 to 10000 | `1` | Events handed to one run. `1` runs the workflow once per event. |
| `maxWaitMs` | 0 to 300000 | `0` | How long a part-filled batch waits. Values from 1 to 999 act as 1000. |
| `maxBytes` | 1024 to 67108864 | `1048576` | Memory limit of one batch. |
| `concurrency` | 1 to 64 | `1` | Batches running at once. Above 1, order is lost. |
| `commitMode` | `auto` or `manual` | `auto` | `auto` marks a message done after a successful run. `manual` leaves that to the workflow. |
| `maxAttempts` | 1 to 5 | `3` | Runs of one batch before it is dead-lettered (`auto`) or handed back (`manual`). |
| `retryDelayMs` | 0 to 300000 | `1000` | Delay before a retry. It doubles after each failure. |

## Source by type

`source` is an object. It is required for queue types.

| Type | Field | Rule |
| --- | --- | --- |
| `redis` | `stream` | Required. 1 to 1024 characters, no spaces. |
| | `consumerGroup` | Optional. Default `fluxify-<triggerId>`. |
| | `consumer` | Optional. Default is the host name. |
| | `fromBeginning` | Optional. A new group starts at the first entry instead of new ones. |
| | `claimIdleMs` | Optional. 1000 to 86400000. How long an entry sits unacknowledged before another consumer takes it. |
| | `dlqStream` | Optional. Default `<stream>:dlq`. |
| `rabbitmq` | `queue` | Required. An existing queue, 1 to 255 characters. Fluxify never creates it. |
| `kafka` | `topics` | Required. 1 to 100 names, each up to 249 characters. |
| | `consumerGroup` | Optional. Letters, digits, `.`, `_`, `-`, up to 200. |
| | `fromBeginning`, `createTopics`, `allowIdleConsumers` | Optional booleans. `createTopics` makes missing topics on save. Off, a missing topic is a 400. |
| `nats` | `stream` | Required. No spaces, `.`, `*`, `>`, `/` or `\`. Up to 255. |
| | `filterSubjects` | Optional. Up to 100 subjects. |
| | `consumerGroup`, `fromBeginning` | Optional. Group: letters, digits, `_`, `-`, up to 200. |
| `sqs` | `queueUrl` | Required. A URL. |
| | `waitTimeSeconds` | Optional. 0 to 20. |
| | `visibilityTimeoutSec` | Optional. 1 to 43200. |

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Invalid input: schedule: A schedule trigger needs a schedule` | Add `schedule`. |
| `Invalid input: schedule: A internal trigger is not fired on a schedule` | Remove `schedule`. It is only for `type: "schedule"`. |
| `Invalid input: schedule: ...is not a known shorthand...` | Use one of the shorthands, `@every`, `@at` or six-field cron. |
| `Invalid input: timezone: Use an IANA timezone name like Asia/Kolkata, not a fixed offset` | Use a name. `Unknown timezone "X"` means the name does not exist. |
| `A schedule trigger has no source to authenticate` | Remove `integrationId`. Same for `internal`. |
| `A Redis trigger needs a valid stream key` | `source` is missing or wrong. Same pattern for the other types. |
| `A Redis trigger needs a Redis integration from this project` | `integrationId` is missing, from another project, or the wrong variant. |
| `Fluxify API error 409: trigger with that name already exists` | Pick another name. |
| `Fluxify API error 400: Workflow belongs to a different project` | Use a workflow of the same project. |
| `Not found: Workflow ... not found` | Wrong `workflowId`. Use `list_workflows`. |
| `Fluxify API error 403` on `kafka`, `nats` or `sqs` | No enterprise licence. |
| Broker message, such as a missing stream or queue | The source does not exist or the credentials fail. Fix it and save again. |

Nothing runs when the trigger is off, has no workflow, or the workflow is inactive. All three must be right. Check `list_triggers` for `disabledReason`. For a worked example see [Recipe, workflow with a cron trigger](/agents/recipes/workflow-cron-trigger).
