# Triggers

A **trigger** is what starts a [workflow](/concepts/workflows). Something
happens — a message arrives, another workflow says so — and the trigger hands
that event to a workflow and lets it run.

One trigger starts exactly one workflow. If two workflows should react to the
same events, make two triggers.

## What a workflow receives

A trigger passes the events it collected to the workflow. Inside the canvas you
read them with the `trigger` variable, in a JS Runner block or any field that
accepts a `js:` expression.

`trigger.data` is **always a list**, even when only one event arrived. That is
deliberate: a workflow written today for one event at a time keeps working
unchanged when you later ask the trigger to collect twenty.

```js
// how many events this run was given
trigger.meta.size

// the payload of the first one
trigger.data[0].data

// every payload
trigger.data.map(function (event) { return event.data; });
```

When exactly one event arrived, `input` is that event's payload on its own, so
the common case stays short:

```js
// a run with one event
input                 // { "orderId": "A-1024" }
trigger.data.length   // 1
trigger.data[0].data  // { "orderId": "A-1024" }

// a run with three events
input                 // [ {...}, {...}, {...} ]
trigger.data.length   // 3
```

### What sits on each event

| Field | What it is |
|---|---|
| `data` | The event's payload |
| `meta.id` | The id the source gave this event, when it gave one |
| `meta.receivedAt` | When the event reached the trigger |
| `meta.source` | Where it came from |

And on the run as a whole:

| Field | What it is |
|---|---|
| `trigger.meta.size` | How many events are in `trigger.data` |
| `trigger.meta.firstReceivedAt` | When the oldest event arrived |
| `trigger.meta.lastReceivedAt` | When the newest one did |

## One at a time, or in batches

Every trigger has a **batch size**.

| Batch size | What happens |
|---|---|
| **1** | The workflow runs once per event. The simple case, and the default. |
| **More than 1** | Events are collected and handed over together, in one run. |

Batching exists for volume. Ten thousand events with a batch size of 1 is ten
thousand workflow runs; with a batch size of 500 it is twenty. If your workflow
writes to a database or calls an API, doing that once for five hundred rows is
far cheaper than five hundred times.

Three settings shape a batch:

| Setting | What it does |
|---|---|
| **Batch size** | The most events one run may receive. |
| **Max wait** | How long a part-filled batch waits for the rest. `0` never waits — whatever is ready goes now. |
| **Max bytes** | A size ceiling on one batch. Whichever limit is reached first ends the batch, so a batch of 500 large events may arrive with far fewer. |

::: tip Start at 1
Use a batch size of 1 until you know volume is a problem. Batching changes how
your workflow has to be written; do it when it buys you something.
:::

## A batch is one piece of work

Everything in a batch succeeds together or fails together.

If the run fails, the **whole batch** is retried — the same events, not just the
ones that had not been handled yet. So a workflow that processes a batch has to
be safe to run twice. If it charges a card or sends an email, guard that step so
a repeat run does not do it again.

`meta.id` is the tool for this. It is the source's own id for an event, stable
across a retry, so you can record what you have already handled and skip it the
second time round. Fluxify does not deduplicate events for you — only you know
what "already handled" means for your work.

## Running several batches at once

**Concurrency** is how many batches a trigger may have in flight at the same
time. It defaults to 1.

Raising it gets through a backlog faster. It also means events are **no longer
handled in order** — two batches running side by side finish in whatever order
they finish. Leave it at 1 if order matters to you.

## Groups

Triggers belong to **groups**. A group is a way to say "these triggers run
together", so a noisy trigger can be given its own workers instead of competing
with everything else in the project.

Every project has a default group, and a trigger lands there unless you choose
another. If groups are not something you need, ignore them — the default one
already works.

## Starting a workflow from a canvas

Not everything that starts a workflow comes from outside. The
[Trigger Workflow](/concepts/blocks) block starts one from inside a route or
another workflow: pick the workflow, hand it some data, and carry on. The run is
queued, not waited for — the block finishes immediately and the workflow runs on
its own.

The data you send has to be small. Each project sets a limit — **64 KB** by
default, **256 KB** at most — in **Project settings → General → Trigger payload
limit**. A larger payload is refused when the block runs, and the workflow is
never started.

::: info Send a reference, not the cargo
If you find yourself near the limit, send an id or a file key and let the
workflow fetch the rest. For genuinely large payloads, use a dedicated trigger
with an integration built to carry them.
:::

## Running one by hand

The **Run** action on a workflow takes the same path a trigger does, so a test
run behaves like the real thing — one event, with the payload you typed in.

## Where to set them up

Open a workflow and go to **Settings → Triggers**. You can add a trigger, turn
one on or off, and delete one from there.

Turning a trigger off stops it collecting events. Events already waiting stay
where they are; nothing is lost, and nothing is read until you turn it back on.
