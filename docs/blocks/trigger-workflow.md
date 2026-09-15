---
title: Trigger Workflow
description: Start a workflow from a route or another workflow.
---

# Trigger Workflow

The **Trigger Workflow** block starts a [workflow](/concepts/workflows) — now,
or once at a later time — and carries on immediately. It does not wait for the
workflow to finish, and it never receives its result.

Use it when a request should kick off background work — a signup that sends a
welcome email, an order that rebuilds a report — without making the caller wait
for that work to happen. Run it **later** for work that belongs in the future: a
reminder 24 hours after signup, a retry in 10 minutes, a reservation that
expires at a set time.

## Inputs

| Field | What it does |
|---|---|
| **When** | **Now** (the default), **Later**, or **Cancel a scheduled run**. |
| **Workflow** | The workflow to start. Pick it from the list. |
| **Run at** | Only for **Later**. When the run should start — see [Running later](#running-later). Accepts a `js:` expression. |
| **Schedule id** | Only for **Cancel**. The id a **Later** block gave back. Accepts a `js:` expression. |
| **Use incoming value** | Send the previous block's output instead of the data below. |
| **Data** | What the workflow receives. Accepts a `js:` expression. |

## Logic

1. The block works out what to send — the incoming value, or the data you set.
2. It queues a run of the chosen workflow with that data.
3. It finishes straight away, and the next block runs.

The workflow starts on a worker some moment later. It gets its own time limit,
its own retries, and its own logs.

## Running later {#running-later}

Set **When** to **Later** and say when in **Run at**. The field accepts three
kinds of value:

| Kind | What you write |
|---|---|
| **Delay pattern** | A raw string of numbers with units, no spaces: `ms` (milliseconds), `s` (seconds), `m` (minutes), `h` (hours). Units combine (`24h12m2s`) and take decimals (`1.5h`). There is no day unit — write 7 days as `168h`. The run starts that long after the block runs. |
| **ISO time** | A raw string in ISO 8601 format: `YYYY-MM-DDTHH:MM:SS` plus a time zone, e.g. `2026-03-01T09:00:00Z`. Date and time are joined by a capital `T`; seconds are optional (`09:00Z`) and may have a fraction (`09:00:00.500Z`). The run starts at that moment. |
| **`js:` expression** | Code that returns either of the above as text, or a JavaScript `Date`. Use it when the time depends on the request or the data. |

::: warning Always say which time zone
The time zone part is required. `Z` means UTC. For a time on a local clock,
give that clock's **offset from UTC** as `+HH:MM` or `-HH:MM` —
`2026-03-01T09:00:00+05:30` is 09:00 in India, `2026-03-01T09:00:00-05:00` is
09:00 in New York in winter. A time with no zone (`2026-03-01T09:00:00`) is
refused rather than guessed, because it would mean a different moment on every
server. An offset does not follow daylight saving, so pick the offset that
applies on the day of the run.
:::

### Examples

From simplest to most involved:

| Run at | Kind | The run starts |
|---|---|---|
| `90s` | Delay pattern | 90 seconds after the block runs |
| `2026-03-01T09:00:00Z` | ISO time | 09:00 UTC on 1 March 2026 |
| `js: return "24h";` | `js:` expression | 24 hours after — the same as typing `24h` |
| `1h30m` | Delay pattern | 1 hour 30 minutes after |
| `2026-03-01T09:00:00+05:30` | ISO time | 09:00 India time (03:30 UTC) on 1 March 2026 |
| `js: return input.plan === "trial" ? "72h" : "24h";` | `js:` expression | 72 hours after for trials, 24 hours for everyone else |
| `24h12m2s` | Delay pattern | 24 hours, 12 minutes and 2 seconds after |
| `2026-03-01T09:00-05:00` | ISO time | 09:00 at UTC−5 (14:00 UTC) on 1 March 2026, seconds left out |
| `js: return input.expiresAt;` | `js:` expression | At the ISO time stored on the record, e.g. a reservation's expiry |
| `1.5h` | Delay pattern | 1 hour 30 minutes after, written as a decimal |
| `js: return new Date(Date.now() + 15 * 60 * 1000);` | `js:` expression | 15 minutes from now, worked out in code |
| `168h` | Delay pattern | 7 days after |
| `js: return input.date + "T09:00:00+05:30";` | `js:` expression | 09:00 India time on the day in `input.date` (e.g. `"2026-03-01"`) |
| `js: return new Date(new Date(input.startsAt).getTime() - 60 * 60 * 1000);` | `js:` expression | One hour before the event in `input.startsAt` |

A `js:` expression that returns a plain number is refused —
`js: return Date.now() + 60000;` fails. Wrap it as `new Date(...)`.

Anything else — `tomorrow`, `2026-03-01` with no time, a misspelt unit — makes
the block fail with an error, and nothing is scheduled.

::: tip Need it to repeat?
**Later** runs a workflow once. For something that runs on the clock — every
day at 9am, every 15 minutes, weekdays only — create a
[schedule](/concepts/schedules) on the **Triggers** page instead. Schedules take
cron expressions and add settings this block doesn't have: a timezone, a
payload, spreading runs across the minute, and dropping runs missed during
downtime.

A schedule can start the **same workflow** this block starts. To tell the two
apart inside the workflow, check where the event came from:

```js
// "schedule" when a schedule started it, "internal" when this block did
trigger.data[0].meta.source
```

Use it in an **If** block, or in any `js:` field, to take a different path for
each.
:::

::: info A time that has already passed runs straight away
If **Run at** works out to a moment in the past, the workflow is started right
away instead, exactly as with **Now**. A computed time that slipped past by a
second should not break your route.
:::

Instead of passing its input along, a **Later** block outputs a handle:

```json
{ "id": "3f1c9a52-7d4e-4b8a-9c61-2a0e5f8b7d13", "runAt": "2026-03-01T09:00:00.000Z" }
```

Keep the `id` — save it next to the order or user it belongs to — if you may
want to cancel the run. Fluxify does not list scheduled runs anywhere; the id is
the only way to refer to one.

A scheduled run:

- **Survives restarts.** Stopping or redeploying Fluxify does not lose it. If the
  system is down when the time comes, the run starts as soon as it is back.
- **Runs once.** However many workers you have, it starts a single time, then
  follows the same [retry](#retry) settings as a run started now.
- **Is checked when the block runs, not when it fires.** The size limit applies
  at scheduling time. If the workflow is deleted or deactivated before the time
  comes, the run is skipped and a warning is logged.

### How far ahead

By default a run can be scheduled up to **30 days** ahead. A **Run at** further
out makes the block fail. Whoever deploys Fluxify can change this limit — see
[Scheduled run limit](/deployments/production#schedule-horizon).

## Cancelling a scheduled run

Use a second Trigger Workflow block with **When** set to **Cancel a scheduled
run**, and put the saved id in **Schedule id** — for example
`js: return vars.reminderId;`.

- Cancelling a run that already started, or one that was already cancelled, does
  nothing and is not an error.
- A value that is not a schedule id makes the block fail.
- Cancel sends no data and needs no workflow, so the Data and Retry tabs are
  hidden.

## Retry

If the workflow run fails, it is run again. The **Retry** tab sets how.

| Field | What it does |
|---|---|
| **Max attempts** | How many times the workflow runs in total, from 1 to 5. Defaults to 5. |
| **Retry delay** | The wait before the first retry. It doubles after each failed attempt: with 1 second, the retries wait 1 s, 2 s, 4 s, 8 s. Defaults to 10 seconds. |

A run the workflow's own error handler deals with counts as a success and is not
retried.

::: info After the last attempt
The event is dropped and the failure is logged. Fluxify does not keep a copy.
If you cannot afford to lose an event, send it through a queue built for that —
Kafka, NATS or SQS — with a [dedicated trigger](/concepts/triggers), and set up
a dead-letter queue there.
:::

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
- Nothing comes back from the workflow. If you need the answer, the work belongs
  in this canvas, not in a workflow. (A **Later** block does output its schedule
  id — that is a handle to the run, not its result.)
- Inside the workflow the data arrives as usual — see
  [Triggers](/concepts/triggers) for what the workflow reads.
