# Schedules

A **schedule** is a [trigger](/concepts/triggers) that runs a
[workflow](/concepts/workflows) on the clock instead of in response to an event.
Every weekday at 9am, every five minutes, or once at a moment you pick.

Set one up in a workflow's **Settings → Triggers**: choose **Schedule** as the
type, write when it should run, and turn it on.

## Writing the schedule

There are four ways to say when. All of them go in the same field.

| You write | It runs |
|---|---|
| `@every 30m` | Every 30 minutes, starting from when you saved it |
| `@daily` | Every day at midnight |
| `0 0 9 * * 1-5` | Every weekday at 09:00 |
| `@at 2026-01-01T09:00:00Z` | Once, on 1 January 2026, and never again |

As you type, the page shows what your schedule means in plain English and lists
**the next five times it will run**. That list is the thing to check. If it does
not show the times you expected, the expression is not the one you wanted —
whatever it looks like it should mean.

### Intervals

`@every` takes a length of time: `30s`, `5m`, `2h`, `1h30m`. The shortest
allowed is one second.

An interval counts from the last run, not from the clock. `@every 1h` saved at
09:20 runs at 10:20, 11:20, and so on — not on the hour.

### Named times

Shorthands for the common cases:

| Shorthand | Means |
|---|---|
| `@hourly` | Every hour, on the hour |
| `@daily` or `@midnight` | Every day at 00:00 |
| `@weekly` | Every Sunday at 00:00 |
| `@monthly` | The 1st of each month at 00:00 |
| `@yearly` or `@annually` | 1 January at 00:00 |

### Cron expressions

For anything else, write a cron expression — **six fields, separated by
spaces**:

```
┌───────────── second       (0-59)
│ ┌─────────── minute       (0-59)
│ │ ┌───────── hour         (0-23)
│ │ │ ┌─────── day of month (1-31)
│ │ │ │ ┌───── month        (1-12)
│ │ │ │ │ ┌─── day of week  (0-6, Sunday is 0)
│ │ │ │ │ │
0 0 9 * * 1-5
```

| Expression | Runs |
|---|---|
| `0 0 9 * * *` | Every day at 09:00 |
| `0 */15 * * * *` | Every 15 minutes |
| `0 30 8 1 * *` | The 1st of each month at 08:30 |
| `0 0 0 * * 0` | Every Sunday at midnight |

::: warning Six fields, not five
Most other tools use **five** fields and start at minutes. Fluxify starts at
**seconds**. If you paste a five-field expression from elsewhere it will be
rejected rather than quietly run at the wrong time — add a leading `0` to make
it six.
:::

### Running once

`@at` followed by a date and time runs the workflow a single time:

```
@at 2026-03-01T02:00:00Z
```

Write the time in the `YYYY-MM-DDTHH:MM:SSZ` form. Once it has run, the
schedule is finished; the trigger stays in the list, but nothing more happens. A
time that has already passed never runs at all, and the preview tells you so
before you save.

## Timezones

A schedule runs in **UTC** unless you say otherwise. To use a local clock, put
an IANA timezone name in the **Timezone** field — `Asia/Kolkata`,
`Europe/Lisbon`, `America/Denver`. Names only; an offset like `+05:30` is not
accepted, because an offset cannot follow daylight saving.

The timezone applies to cron expressions and named times. `@every` and `@at`
ignore it — an interval has no wall clock to follow, and `@at` already carries
its own.

::: warning Daylight saving can skip or repeat a run
In a timezone that changes its clocks, one day each year is an hour shorter and
another is an hour longer.

- A schedule set for a time that is **skipped** on the shorter day does not run
  that day.
- A schedule set for a time that **happens twice** on the longer day may run
  twice.

This is not something Fluxify can decide on your behalf — both answers are wrong
for somebody. If a run must happen exactly once a day, use UTC, which never
shifts.
:::

## When runs actually happen

A schedule is a promise about *when work starts*, not about how long it takes.
A workflow that takes ten minutes and is scheduled every five minutes will
overlap with itself.

Two more things are worth knowing:

**Runs are spread across the minute.** If a hundred schedules all say "midnight",
starting them on the same second would be a spike. Fluxify moves each one to its
own second within that minute unless you named a second yourself — so `@daily`
may actually run at `00:00:37`, and it will use that same second every day. Write
`0 0 0 * * *` if you need midnight exactly.

**A schedule is one run, never a batch.** The batch settings other triggers have
do not apply: each firing starts the workflow once, with no incoming payload to
collect. A workflow that has five hundred rows to work through fetches them
itself.

If you set a **payload** on the trigger, every run receives that same value as
`input`.

## After downtime

If Fluxify is stopped and later started again, schedules that were due in the
meantime **do not all fire at once**.

A missed run is only worth starting for a while. A schedule that runs every
minute has nothing to gain from a run that is an hour late — the next one is
already due — so overdue runs are dropped rather than delivered in a burst that
would flood your workflows the moment the system came back.

| Schedule | If the system was down for an hour |
|---|---|
| `@every 1m` | Nothing catches up. It resumes on the next minute. |
| `@daily` | The day's run is dropped if it was missed by more than a few minutes. |
| `@at …` | Runs as soon as the system is back, however late. A one-off has no next time. |

If you need a guaranteed catch-up — every missed day processed, not skipped —
build it into the workflow: have it work out what it last handled and cover the
gap. Only your workflow knows what "missed" means for your data.

## Turning one off

The switch beside a trigger stops it. A stopped schedule does not fire, and no
runs pile up while it is off — turning it back on resumes from the next time the
schedule comes round, not from the ones you skipped.

Deleting the trigger removes the schedule outright.

## Things that go wrong

| What you see | What it usually is |
|---|---|
| The schedule is rejected when you save | The expression could not be read. The message says which part; check the field count first — six, not five. |
| The preview says "This never fires" | An `@at` time that has already passed. |
| It runs an hour early or late twice a year | The timezone observes daylight saving. Use UTC if the run must be at a fixed interval. |
| It runs a few seconds after the time you set | Expected — runs are spread across the minute. Name the seconds field to pin it. |
| Nothing runs at all | The trigger is off, or the workflow it points at is inactive. Both have to be on. |
