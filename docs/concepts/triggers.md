---
title: Triggers
description: What starts a workflow, what the workflow receives in trigger.data, and how batching and queue triggers work.
---

# Triggers

A **trigger** is what starts a [workflow](/concepts/workflows). Something
happens — a message arrives, another workflow says so — and the trigger hands
that event to a workflow and lets it run.

A trigger starts **one workflow**. To run more than one workflow from the same
source, either create another trigger with the same settings, or have the first
workflow start the others with the [Trigger Workflow](/concepts/blocks) block.

A trigger that runs on the clock rather than on an event is a
[schedule](/concepts/schedules) — cron expressions, intervals, and one-off
times are covered there.

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
| **Max wait** | How long a part-filled batch waits for the rest. A full batch never waits. Under a second is rounded up to a second, which is the shortest wait the system can promise. |
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

To give a group its own workers, start those workers with `WORKER_GROUP_ID` set
to the group's id. They run only that group's triggers, and every other worker
keeps running the rest. See [Running triggers on their own workers](/deployments/production#trigger-groups).

### How many triggers a group holds

A group holds at most **5** triggers. Every trigger is a queue the group's
workers watch, so a small cap keeps a worker from being spread too thin. Once a
group is full it shows as **Full** in the group picker, and adding a trigger to
it (creating one, or moving one in) is refused. Put the rest in another group.

If your workers run on fast machines that can handle more, raise the limit with
`MAX_TRIGGERS_PER_GROUP` (for example `MAX_TRIGGERS_PER_GROUP=10`).

A group that already has more than the limit keeps working and stays editable.
It just can't take more triggers until it drops below the limit.

## When an integration changes

A trigger that reads from an external source uses one of your
[integrations](/integrations/) for its credentials.

- **Edit the integration** and its triggers reconnect with the new details
  within a few seconds. Nothing has to be restarted.
- **Delete the integration** and every trigger using it is deleted too. They
  stop reading straight away.

## When the queue, topic or stream is deleted

A trigger whose source is deleted while it is running has nothing left to read,
and retrying cannot bring it back. Fluxify notices, stops the consumer and
**turns the trigger off**, with the reason shown on the trigger so you know why
without reading logs:

| Source | What is noticed |
|---|---|
| SQS | The queue no longer exists. |
| Kafka | A topic the trigger reads no longer exists. |
| NATS | The stream, or the trigger's durable consumer on it, no longer exists. |
| Redis Streams | The stream, or the trigger's consumer group on it, no longer exists. |
| RabbitMQ | The queue no longer exists. |

Two things to know:

- **Runs already started are left alone.** They finish normally. Only the
  reading stops.
- **A Kafka trigger reads all of its topics as one source.** If one of several
  topics is deleted, the whole trigger is turned off — the message names the
  topics so you can see which one went. Kafka triggers with **Create missing
  topics** on are the exception: a missing topic is created again instead.

Recreate the source, then turn the trigger back on. A Redis Streams trigger
creates its stream and group again by itself when it is turned back on, starting
empty.

## Reading from Kafka

A Kafka trigger runs its workflow for messages arriving on one or more topics.
It needs a [Kafka integration](/integrations/message-queues) for the brokers
and credentials, and an enterprise license.

| Setting | What it does |
|---|---|
| **Topics** | The topics to read, separated by commas. They are checked when you save: a topic that does not exist is refused with its name. |
| **Create missing topics** | Instead of refusing, create any missing topic — when you save, and again whenever the trigger starts — with your cluster's default number of partitions and replicas. The Kafka user needs permission to create topics. With this off, a topic that has gone missing turns the trigger off instead. |
| **Read messages already in the topic** | Off: the trigger starts with messages sent after it is created. On: it starts from the oldest message still kept. Only matters the first time; after that it always carries on from where it stopped. |
| **Max attempts** | How many times a failing batch is run before it is sent to the dead-letter topic. Defaults to 3, at most 5. |
| **Retry delay** | The pause before the first retry. It doubles after each failed attempt: with 1000 ms, the retries wait 1 s, 2 s, 4 s, 8 s (never more than 5 minutes). |
| **Commit from the workflow** | See below. |

Each event carries where it came from: `meta.topic`, `meta.partition`,
`meta.offset`, `meta.key`, `meta.headers` and `meta.timestamp`. A message body
that is valid JSON arrives parsed; anything else arrives as text.

Batch size, max wait, max bytes and concurrency work as described above.
Concurrency here counts **partitions**: each partition always runs in order, and
up to that many partitions run side by side.

`trigger.meta.attempt` is `1` on the first run of a batch and counts up on each
retry.

### Committing from the workflow

By default a batch is marked done as soon as its run succeeds. Turn on **Commit
from the workflow** when you want to decide that yourself — for example, only
after a slow downstream write is confirmed:

```js
// in a JS Runner block, once the batch is safely handled
await trigger.connection.commit();
```

A batch that is never committed is read again after a restart. In this mode a
batch that keeps failing is **not** sent to the dead-letter topic; your workflow
can do that itself with `await trigger.connection.moveToDLQ(error)`.
`await trigger.connection.lag()` tells you how many messages are still waiting.

See [Message Queue Integrations](/integrations/message-queues) for what happens
to failing messages and how the dead-letter topic works.

## Reading from NATS

A NATS trigger runs its workflow for messages stored in a **JetStream stream**
on your own NATS cluster. It needs a [NATS integration](/integrations/message-queues#nats)
and an enterprise license.

| Setting | What it does |
|---|---|
| **Stream** | The stream to read. It is checked when you save and again whenever the trigger starts, and must already exist — Fluxify never creates streams. A stream deleted under a running trigger turns it off. |
| **Subjects** | Optional. Only read these subjects of the stream, separated by commas (`orders.eu, orders.us.*`). Empty reads every subject the stream holds. |
| **Read messages already in the stream** | Off: only messages sent after the trigger starts. On: start from the oldest message the stream still keeps. Only matters the first time. |
| **Max attempts**, **Retry delay**, **Commit from the workflow** | Work exactly as for Kafka, above. |

Each event carries where it came from:

| Field | What it is |
|---|---|
| `meta.topic` | The subject the message was published on |
| `meta.offset` | Its position in the stream |
| `meta.key` | The message's `Nats-Msg-Id` header, or `null` |
| `meta.headers` | Its headers |
| `meta.timestamp` | When the stream stored it |

A message body that is valid JSON arrives parsed; anything else arrives as text.

A stream has no partitions, so **Concurrency** is simply how many batches run at
once. Messages run in order only at a concurrency of 1.

::: tip A part-filled batch waits at least a second
NATS triggers wait at least one second for a batch to fill, even when **Max
wait** is shorter.
:::

## Reading from Redis Streams

A Redis Streams trigger runs its workflow for entries added to a Redis stream.
It reads through a [Redis KV integration](/integrations/kv-stores), the same one
the KV blocks use. It works in **every edition**, with no license.

| Setting | What it does |
|---|---|
| **Stream key** | The stream to read. If it does not exist yet, it is created empty when the trigger starts. |
| **Consumer group** | The group the trigger reads as. Fluxify names one per trigger; name your own to share the work with other readers of the stream. Created when the trigger starts if it is missing. |
| **Consumer name** | Optional. By default every worker reads under its own name. Set a fixed name only when a single worker runs the trigger. |
| **Read entries already in the stream** | Off: only entries added after the group is created. On: start from the first entry in the stream. Only matters when Fluxify creates the group. |
| **Reclaim after** | How long an entry left unfinished waits before it is read again — because its worker crashed, or its run failed in **Commit from the workflow** mode. Defaults to 60 seconds. A run that is still going keeps its entries, however long it takes. |
| **Dead-letter stream** | Where an entry goes once its attempts run out. Defaults to `<stream key>:dlq`. |
| **Max attempts**, **Retry delay**, **Commit from the workflow** | Work exactly as for Kafka, above. |

A Redis stream entry is a set of named fields, and that is what `data` holds.
The values are always **text**, exactly as Redis stores them:

```js
// added with: XADD orders * id 42 status paid
trigger.data[0].data   // { "id": "42", "status": "paid" }
```

To send structured data, put JSON in one field and read it with
`JSON.parse(trigger.data[0].data.payload)`.

Each event also carries where it came from:

| Field | What it is |
|---|---|
| `meta.topic` | The stream key |
| `meta.offset` | The entry's id, e.g. `1727771234567-0` |
| `meta.timestamp` | When the entry was added |
| `meta.consumer` | The name this worker reads under |
| `meta.deliveryCount` | How many times Redis has handed this entry out, this time included |

`trigger.meta.consumerGroup` is the group's name.

Good to know:

- **Leftover work comes first.** When a worker starts, it first runs the entries
  it read before a restart and never finished, then entries other workers left
  unfinished, then new ones.
- **Use Max wait to batch entries that trickle in.** Redis hands over whatever
  is waiting the moment one entry arrives. With a Max wait of 0, entries added
  one at a time run one at a time, whatever the batch size. With a Max wait of,
  say, 1000 ms, entries added within that second run together, up to the batch
  size. Max wait is capped at half of **Reclaim after**.
- **Entries run in order only at a concurrency of 1.**
- **Fluxify never trims the stream.** A handled entry stays in it. Keep the
  stream's size in check where you add to it (`XADD orders MAXLEN ~ 100000 * ...`)
  or with `XTRIM`.
- A dead-lettered entry keeps its fields and gains `x-fluxify-error`,
  `x-fluxify-stream`, `x-fluxify-id` and `x-fluxify-consumer-group`.

::: info Which servers work
Redis Streams triggers need **Redis 6.2 or newer**, and were tested on Redis 7.
`trigger.connection.lag()` returns `null` before Redis 7. Redis-compatible
servers work when they support consumer groups and waiting reads. Some hosted
services limit how long a read may wait (Upstash, for example), so test yours
before you rely on it.
:::

## Reading from RabbitMQ

A RabbitMQ trigger runs its workflow for messages on a RabbitMQ queue. It needs
a [RabbitMQ integration](/integrations/message-queues#rabbitmq) and works in
**every edition**, with no license.

| Setting | What it does |
|---|---|
| **Queue** | The queue to read. It must already exist, with its bindings. Fluxify never creates it. It is checked when you save and whenever the trigger starts. |
| **Max attempts**, **Retry delay** | Work as for Kafka, above. After the last failed attempt the messages are rejected to the queue's **dead-letter exchange**. A queue without one deletes them: see [Retries and dead-lettering](/integrations/message-queues#retries-and-dead-lettering). |
| **Commit from the workflow** | See below. |

There is no prefetch setting. Fluxify sets prefetch to **Batch size ×
Concurrency**, so a batch can always fill.

The message body arrives in `data`, parsed when it is valid JSON and as text
otherwise. Each event also carries where it came from:

| Field | What it is |
|---|---|
| `meta.topic` | The queue name |
| `meta.exchange` | The exchange it was published to. Empty for the default exchange. |
| `meta.routingKey` | Its routing key. `meta.key` holds the same value. |
| `meta.messageId` | The message id the publisher set, or `null` |
| `meta.offset` | The message id when there is one, otherwise the delivery tag |
| `meta.id` | `<queue>:0:<offset>`. Stable across redeliveries **only when the publisher sets a message id**. |
| `meta.deliveryTag` | RabbitMQ's number for this delivery. It starts again from 1 after a reconnect, so never store it. |
| `meta.redelivered` | `true` when RabbitMQ delivered this message before |
| `meta.deliveryCount` | Deliveries so far, this one included. Exact on quorum queues. A classic queue only knows "before or not", so it is `1` or `2`. |
| `meta.headers` | Its headers, as text |
| `meta.properties` | The other AMQP properties that were set: `contentType`, `correlationId`, `replyTo`, `priority`, `type`, `appId`, `expiration`, ... |
| `meta.timestamp` | The message's own timestamp when it has one, otherwise when it arrived |

`trigger.meta.attempt` starts at `meta.deliveryCount`, so a message RabbitMQ has
already delivered once starts its run at attempt 2. A message whose deliveries
are already past **Max attempts** does not run again: it goes straight to the
dead-letter exchange, or, with **Commit from the workflow** on, back to the
queue. For example, with **Max attempts** at 1, a message whose worker crashed
mid-run is dead-lettered when it comes back.

::: tip Set a message id when you publish
For safe deduplication, give every message a `messageId` when you publish it.
Then `meta.id` stays the same however many times the message is delivered.
Without one, each delivery gets a new `meta.id`.
:::

### Committing from the workflow on RabbitMQ

With **Commit from the workflow** on:

- `await trigger.connection.commit()` acknowledges every message in the batch.
- `await trigger.connection.moveToDLQ(error)` rejects them to the queue's
  dead-letter exchange. The error is logged, not attached to the message.
- A batch the run neither commits nor dead-letters, whether the run succeeded
  or failed, goes back to the queue after the **Retry delay**. That delay
  doubles with each delivery, up to 5 minutes. It is then delivered again,
  marked `meta.redelivered`.
- Committing a batch twice, or committing after `moveToDLQ`, does nothing. Each
  message is settled once.

Keep an eye on RabbitMQ's 30 minute **consumer timeout** and, on quorum queues,
its **delivery limit**. Both are explained in
[RabbitMQ limits that affect triggers](/integrations/message-queues#rabbitmq-limits-that-affect-triggers).

## Using the client directly

For Kafka, NATS, Redis Streams and RabbitMQ triggers, `trigger.connection.raw` is the client Fluxify
reads the batch with. Use it for what `commit`, `moveToDLQ` and `lag` do not
cover — for example, publishing a reply on NATS:

```js
// NATS: send a message on another subject
trigger.connection.raw.publish("orders.processed", JSON.stringify({ id: input.orderId }));
```

| Trigger | What `raw` is | Where to read about it |
|---|---|---|
| Kafka | A `Consumer` from `@platformatic/kafka` | [github.com/platformatic/kafka](https://github.com/platformatic/kafka) |
| NATS | A `NatsConnection` from `@nats-io/nats-core` | [github.com/nats-io/nats.js](https://github.com/nats-io/nats.js) and [docs.nats.io](https://docs.nats.io) |
| Redis Streams | A `Redis` client from `ioredis` | [github.com/redis/ioredis](https://github.com/redis/ioredis) |
| RabbitMQ | The consuming `Channel` from `amqplib`, with some commands blocked (below) | [amqp-node.github.io/amqplib](https://amqp-node.github.io/amqplib/channel_api.html) |

::: danger Handle with care
This is the live connection the trigger itself depends on, shared by every run of
that trigger on the worker. Closing it, draining it, pausing it, changing its
subscriptions or committing past a batch can stop the trigger from reading,
skip or repeat messages, or leave it in a broken state **until the worker
restarts**. Only use it if you know what the call does to a running consumer,
and prefer the built-in helpers whenever they are enough.
:::

### The RabbitMQ channel

On a RabbitMQ trigger, `raw` is the channel the trigger consumes on. It always
points at the live channel, including after a reconnect. While the trigger is
reconnecting, using it throws an error saying so.

Fluxify settles the messages and owns the consumer, so these commands **throw**
instead of running: `ack`, `ackAll`, `nack`, `nackAll`, `reject`, `cancel`,
`close`, `recover` and `prefetch`. Use `trigger.connection.commit()` and
`moveToDLQ()` to settle a batch.

Everything else works, for example publishing a reply:

```js
// RabbitMQ: publish a result to another exchange
trigger.connection.raw.publish(
  "orders.events",
  "order.processed",
  Buffer.from(JSON.stringify({ id: input.orderId })),
  { persistent: true, messageId: input.orderId, contentType: "application/json" },
);
```

Things to know when publishing or declaring through it:

- **Publishing is not confirmed.** The channel is not in confirm mode, so
  `publish` returns as soon as the message is written to the connection, before
  RabbitMQ stores it. A crash or lost connection right after can lose it.
- **Messages are not persistent unless you ask.** Pass `persistent: true`, or
  RabbitMQ keeps the message in memory only and a broker restart loses it.
- **A message no queue is bound for is dropped silently** unless you pass
  `mandatory: true`.
- **A refused command closes the channel.** Publishing to an exchange that does
  not exist, `checkQueue` / `checkExchange` on something missing, or declaring a
  queue with different settings than it already has makes RabbitMQ close the
  channel. Every message the trigger holds on it (this batch and any others in
  flight) goes back to the queue and is delivered again, and the trigger
  reconnects. Declare and check things in RabbitMQ itself, not from a workflow.
- **The channel is shared** by every run of the trigger on that worker. A slow
  call on it holds up the others.

## Starting a workflow from a canvas

Not everything that starts a workflow comes from outside. The
[Trigger Workflow](/concepts/blocks) block starts one from inside a route or
another workflow: pick the workflow, hand it some data, and carry on. The run is
queued, not waited for — the block finishes immediately and the workflow runs on
its own.

The block can also hold a run for later: "in 24 hours" or "at 09:00 on 1 March".
It gives back an id you can keep, and a second Trigger Workflow block can cancel
the run with that id before it starts. A time that has already passed runs
straight away. See [Running later](/blocks/trigger-workflow#running-later).

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

## Running on a schedule

A trigger can also be started by the clock: every weekday at 9am, every five
minutes, or once at a time you pick. See [Schedules](/concepts/schedules).

Schedules do not batch. Each firing starts the workflow once, because there is
no queue of incoming events to collect from — a scheduled workflow fetches
whatever it needs to work on itself.

## Where to set them up

Triggers live on the project's **Triggers** page. Create one there — name it,
say what fires it, and choose the workflow it starts.

A workflow's own **Settings → Triggers** tab shows what currently starts it. You
can attach a trigger that is not yet attached to anything, detach one, or turn
one on and off from there. A trigger that already starts another workflow has
to be detached from that workflow first. **New trigger** opens the create form
in a new tab so an unsaved canvas is not lost.

A trigger with no workflow attached is saved and idle — it collects nothing and
starts nothing until you attach one.

Turning a trigger off stops it collecting events. Events already waiting stay
where they are; nothing is lost, and nothing is read until you turn it back on.
