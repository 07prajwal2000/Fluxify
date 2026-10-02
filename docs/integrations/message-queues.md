---
title: Message Queue Integrations
description: Start workflows from messages on a Kafka topic, a NATS JetStream stream, an AWS SQS queue or a RabbitMQ queue, and send messages to them from a workflow.
---

# Message Queue Integrations

A message queue integration lets a [trigger](/concepts/triggers) start a
workflow every time messages arrive on a Kafka topic, a NATS stream, an AWS SQS
queue or a RabbitMQ queue. The integration holds the connection details; the trigger says what
to read and which workflow to run.

Workflows and routes can **send** too: the [Send Message](/blocks/send-message)
block publishes one message or a list to the same integrations, except RabbitMQ,
which it does not support yet.

::: info Enterprise
Kafka, NATS and SQS triggers, and Send Message blocks that use them, need an
enterprise license. Creating such a trigger, or saving such a block, is
refused until a license is active.

**RabbitMQ** triggers are free in every edition, with no license.

Reading and writing a **Redis stream** is free in every edition too. It uses a
[Redis KV integration](/integrations/kv-stores) rather than one of these — see
[Reading from Redis Streams](/concepts/triggers#reading-from-redis-streams) and
[Send Message](/blocks/send-message).
:::

**Send timeout** (Kafka, NATS and SQS) is how long the Send Message block waits
for the broker to confirm a message, 30 seconds by default.

## Kafka

Works with Apache Kafka and anything that speaks the Kafka protocol — Redpanda,
Confluent Cloud, Amazon MSK, Aiven, and so on.

| Setting | What it is |
|---|---|
| **Brokers** | One or more `host:port` addresses, separated by commas. One reachable broker is enough; the rest are found from it. |
| **Client ID** | A name the brokers show for this connection. Optional; defaults to `fluxify`. |
| **Authentication** | `None`, or a SASL login: `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. |
| **Username / Password** | The SASL login, when authentication is on. |
| **Use TLS** | Turn on when the brokers expect an encrypted connection. Most hosted Kafka services do. |
| **Dead-letter topic** | Under **Advanced**. Where messages that keep failing are sent. See below. |

Every field accepts an [App Config](/concepts/app-config) key, so passwords do
not have to be typed into the integration itself.

**Test connection** connects to the brokers and lists their topics. If it
fails, the message names the reason — a wrong address, a refused login, or a
broker that is not answering.

### Example: Confluent Cloud

- **Brokers**: `pkc-xxxxx.us-east-1.aws.confluent.cloud:9092`
- **Authentication**: `SASL PLAIN`
- **Username / Password**: your cluster API key and secret
- **Use TLS**: on

## Topics that do not exist yet

When you save a Kafka trigger, Fluxify checks that its topics exist. A missing
topic is refused with its name, so a trigger never sits quietly waiting on a
typo. Tick **Create missing topics** on the trigger to have them created
instead, with your cluster's default partitions and replicas. The login on the
integration needs permission to create topics for that to work.

The same check runs whenever the trigger starts, and a topic deleted while it is
running is noticed too. With **Create missing topics** on, the topic is simply
created again — several workers starting at once is fine, whoever loses the race
still gets its topic. With it off, the trigger is
[turned off with the reason](/concepts/triggers#when-the-queue-topic-or-stream-is-deleted)
rather than reading nothing.

The brokers have to be reachable when you save a Kafka trigger's topics or
integration. Other edits — renaming it, turning it on or off — do not contact
them.

## What happens to each message (Kafka and NATS)

A message is marked done — **committed** — once the workflow run that received
it succeeds. After a restart, reading carries on from the last committed
message, so nothing is skipped.

If the run fails, the same batch is run again, up to the trigger's **Max
attempts** (at most 5). The wait starts at **Retry delay** and doubles after
each failed try. What happens after the last
attempt depends on the dead-letter topic:

| Dead-letter topic | After the last failed attempt |
|---|---|
| **Set** | The messages are copied to the dead-letter topic and then committed. The trigger moves on to the next messages. |
| **Not set** | The messages are not committed. The trigger keeps retrying them. On Kafka, the messages behind them on the same partition wait. On NATS, the server sends them back with a growing delay (up to 30 seconds) while later messages keep flowing. |

On NATS, "dead-letter topic" here means the integration's **dead-letter subject**.

::: warning One bad message can hold up a partition
Without a dead-letter topic, a message your workflow can never handle stops
everything behind it on its partition. Other partitions keep flowing. Set a
dead-letter topic unless you would rather fix the problem and have the messages
retried.
:::

### What a dead-lettered message looks like

It is the original message — same key, same body, same headers — with these
headers added so you can tell where it came from and why it failed:

| Header | Value |
|---|---|
| `x-fluxify-error` | The error the last attempt failed with |
| `x-fluxify-topic` | The topic it was read from |
| `x-fluxify-partition` | Its partition |
| `x-fluxify-offset` | Its position in that partition |
| `x-fluxify-consumer-group` | The trigger's consumer group |

To reprocess dead-lettered messages, point a trigger at the dead-letter topic,
or send them back to the original topic once the cause is fixed.

::: tip Create the topic first
Create the dead-letter topic on your cluster before you rely on it. If the
brokers do not allow topics to be created automatically, sending to a topic
that does not exist fails, and the batch is retried instead.
:::

## NATS

Reads from **JetStream streams** on your own NATS cluster. This is a cluster you
run or rent — not the one Fluxify uses internally. JetStream must be turned on.

| Setting | What it is |
|---|---|
| **Servers** | One or more `nats://host:port` addresses, separated by commas. |
| **Authentication** | `None`, `Username & password`, `Token`, `Credentials file` (the contents of a `.creds` file) or `NKey seed` (starts with `SU`). |
| **Use TLS** | Turn on when the servers expect an encrypted connection. |
| **Dead-letter subject** | Under **Advanced**. Where messages that keep failing are published. See below. |

Every field accepts an [App Config](/concepts/app-config) key.

**Test connection** logs in and reads your account's JetStream details. It fails
if the login is refused or JetStream is not enabled for the account.

NATS triggers need an enterprise license, as Kafka triggers do.

### Streams and the dead-letter subject

Fluxify never creates streams. Create the stream a trigger reads before saving
the trigger — saving checks it exists, and so does every start. Deleting the
stream, or the trigger's durable consumer on it, while the trigger is running
[turns the trigger off with the reason](/concepts/triggers#when-the-queue-topic-or-stream-is-deleted)
rather than leaving it reading nothing.

The dead-letter subject works like Kafka's dead-letter topic, with the same
`x-fluxify-*` headers (`x-fluxify-topic` holds the subject, `x-fluxify-offset`
the stream position). It **must be a subject some stream stores**: publishing to
a subject no stream captures fails, and the batch is retried instead of being
dead-lettered. The simplest setup is a separate stream, such as `DLQ` capturing
`fluxify.dlq`.

Each NATS trigger reads through its own durable consumer on the stream, named
`fluxify-<trigger id>`, so two triggers on the same stream each get every
message, and a restart carries on from the last committed message.

## SQS

Reads from an **Amazon SQS** queue — standard or FIFO — including
SQS-compatible emulators such as LocalStack, by pointing an integration at a
custom endpoint.

| Setting | What it is |
|---|---|
| **Region** | The AWS region the queue lives in. |
| **Access key ID / Secret access key** | Optional. Leave both empty to use the server's own AWS credentials — an IAM role or the SDK's default credential chain. |
| **Session token** | Under **Advanced**. Only for temporary credentials; the trigger stops reading once they expire. |
| **Endpoint** | Under **Advanced**. An SQS-compatible endpoint, such as a local emulator. Leave empty for AWS. |

Every field accepts an [App Config](/concepts/app-config) key.

The credentials need `sqs:GetQueueAttributes`, `ReceiveMessage`,
`DeleteMessage` and `ChangeMessageVisibility` on the queue. **Test connection**
lists your account's queues; a key scoped to a single queue still passes, since
AWS only refuses the list after the signature checks out.

A trigger points at one queue by its **Queue URL** — Fluxify never creates a
queue. Saving a trigger, and every time it starts, checks the queue exists;
a queue deleted while the trigger is running
[turns it off with the reason](/concepts/triggers#when-the-queue-topic-or-stream-is-deleted).

| Setting | What it is |
|---|---|
| **Wait time** | How long one request waits for messages, 0–20 seconds. 20 means fewer requests and a lower AWS bill; 0 polls constantly and is billed per request. |
| **Visibility timeout** | How long a received message stays hidden from other readers, 1 second – 12 hours. Set it longer than your slowest run — Fluxify extends it automatically while a run is still working, but only up to this ceiling. |

SQS hands over at most 10 messages per receive, so **Batch size** above 10 is
accepted but never filled past 10 in one run.

### Retries and dead-lettering work differently on SQS

Kafka and NATS triggers manage their own retries and dead-letter topic. SQS
does not — a queue's **redrive policy**, configured in AWS on the queue
itself, is what decides where a failing message ends up:

- A message stays hidden after each failed or uncommitted run, for the
  trigger's **Retry delay**, doubling after each attempt as it does on Kafka
  and NATS — then reappears for another receive. The trigger's **Max
  attempts** is not used; how many receives a message survives before it is
  moved anywhere is the queue's own setting, below.
- If the queue has a redrive policy, AWS moves the message to its
  dead-letter queue itself once it has been received `maxReceiveCount` times.
  Point a separate trigger at that queue to read dead-lettered messages.
- If the queue has no redrive policy, a failing message is retried
  indefinitely until the queue's retention period deletes it. Saving or
  enabling an SQS trigger without one warns you of this.

## RabbitMQ

Reads from a queue on **RabbitMQ** 3.x or 4.x, or any broker that speaks AMQP
0-9-1 (the protocol RabbitMQ uses). Tested on RabbitMQ 4.2. RabbitMQ triggers
work in **every edition**, with no license.

Brokers that only speak AMQP 1.0, such as Azure Service Bus or ActiveMQ
Artemis, are not supported by this integration.

| Setting | What it is |
|---|---|
| **Host / Port** | The broker's address. Port defaults to `5672`, or `5671` with TLS. |
| **Username / Password** | The login. Left both empty, `guest` / `guest` is used, which RabbitMQ only accepts from the same machine. |
| **Virtual host** | The vhost the queue lives in. Empty is the default vhost, `/`. |
| **Use SSL?** | Connect over TLS (`amqps`). Most hosted RabbitMQ services need it. |
| **Via URL** | Instead of the fields above, one `amqp://` or `amqps://` URL, such as the one CloudAMQP gives you. Write the default vhost as `%2F` (`amqps://user:pass@host/%2F`). |

Every field accepts an [App Config](/concepts/app-config) key.

**Test connection** logs in to the virtual host and opens a channel. If it
fails, the message names the reason: the broker cannot be reached, the login was
refused, or the user may not use that virtual host.

### Setting up the queue

Fluxify **never creates queues, exchanges or bindings**. Create the queue a
trigger reads, and bind it to your exchanges, in RabbitMQ first. Saving a
trigger checks that the queue exists, and so does every start. A queue deleted
while the trigger is running
[turns the trigger off with the reason](/concepts/triggers#when-the-queue-topic-or-stream-is-deleted).

Classic and quorum queues work. RabbitMQ **stream** queues (`x-queue-type:
stream`) are not supported. Quorum queues are recommended
for anything you can't afford to lose; they also count redeliveries exactly
(see `meta.deliveryCount` in [Reading from RabbitMQ](/concepts/triggers#reading-from-rabbitmq)).

### Retries and dead-lettering

There is no dead-letter field on the integration or the trigger. RabbitMQ has
its own: a **dead-letter exchange** set on the queue. Fluxify uses it.

- **A run succeeds:** the messages are acknowledged (removed from the queue).
- **A run fails:** Fluxify runs the same batch again, up to the trigger's
  **Max attempts** (at most 5). The wait starts at **Retry delay** and doubles
  each time. The messages stay with the trigger, unacknowledged, while it
  retries.
- **The last attempt fails:** the messages are **rejected without requeue**.
  RabbitMQ sends them to the queue's dead-letter exchange. RabbitMQ adds
  `x-death` and `x-first-death-*` headers saying which queue they came from and
  why (`rejected`). The error text itself is not attached, because RabbitMQ has
  no way to carry it. It is written to the worker's log.

::: danger A queue without a dead-letter exchange deletes failed messages
If the queue has no dead-letter exchange, RabbitMQ **drops** a rejected message.
Fluxify can't check this for you, so saving a RabbitMQ trigger always shows a
reminder. Set `x-dead-letter-exchange` (and optionally
`x-dead-letter-routing-key`) on the queue, or with a policy, before you rely on
the trigger.
:::

To reprocess dead-lettered messages, bind a queue to the dead-letter exchange
and point a second trigger at it, or move them back once the cause is fixed.

### What Fluxify does on its own

These are the defaults Fluxify uses, which no setting changes. They matter most
if you use the [raw channel](/concepts/triggers#using-the-client-directly) or
look at the trigger in the RabbitMQ management UI.

| What | Behavior |
|---|---|
| **Connections** | Each worker opens one connection and one channel per trigger. The connection is named `fluxify fluxify-<trigger id>` in the management UI. |
| **Prefetch** | Batch size × Concurrency, at most 65,535. That is how many messages RabbitMQ hands the trigger before it acknowledges any. Saving warns you if the product is over the limit, because batches can then never fill and wait for **Max wait** instead. |
| **Lost connection** | Retried forever, waiting 0.1 seconds at first and up to 30 seconds between tries. RabbitMQ puts every unacknowledged message back on the queue and delivers it again (`meta.redelivered` is `true`). |
| **A message from before a reconnect** | Acknowledging it is skipped, because RabbitMQ has already put it back. It runs again. |
| **A failed or uncommitted batch in Commit-from-the-workflow mode** | Put back on the queue after the **Retry delay**, doubling on each delivery, never more than 5 minutes. It never comes back straight away, so a bad message can't spin. The message is held, unacknowledged, during that wait. |
| **Message body** | Parsed as JSON when it is valid JSON, otherwise text. An empty body is `null`. The `content-type` property is not used to decide. Binary bodies arrive as text and may be garbled, so send binary data base64-encoded. |
| **Headers** | Text headers arrive as they are. Numbers, booleans and tables (such as `x-death`) arrive as JSON text. |
| **`lag()`** | Messages ready in the queue. Messages handed to a consumer and not yet acknowledged are not counted. |

### RabbitMQ limits that affect triggers

- **Consumer timeout (30 minutes by default).** RabbitMQ closes a channel that
  holds an unacknowledged message longer than its `consumer_timeout`. Every
  message on that channel then goes back to the queue and is delivered again.
  Fluxify reconnects by itself. The time counts all attempts and retry delays,
  not only one run. Keep *(run time × Max attempts) + retry delays* well under
  30 minutes, or raise `consumer_timeout` on the broker.
- **Quorum queue delivery limit (20 by default on RabbitMQ 4).** A quorum queue
  dead-letters, or drops, a message on its own once it has been returned that
  many times. In **Commit from the workflow** mode, a message your workflow
  never commits is returned each time, so it counts toward this limit.
- **Ordering.** A message put back on the queue goes back near the front. With
  **Concurrency** above 1, or a second worker, messages finish in any order.

### How it differs from Kafka

| | Kafka | RabbitMQ |
|---|---|---|
| A handled message | Stays on the topic. The trigger's position moves past it. | Removed from the queue. |
| Two triggers on the same source | Each gets every message (own consumer group). | They **share** the queue: each message goes to one of them. To give two workflows every message, bind two queues to the exchange. |
| Dead letters | A topic set on the integration. Fluxify copies the message there with `x-fluxify-*` headers. | The queue's own dead-letter exchange. RabbitMQ moves the message and adds `x-death` headers. |
| Creating the source | Optional (**Create missing topics**). | Never: create queues and bindings in RabbitMQ. |
| A stable id for deduplication | Always (`meta.id` is topic, partition and offset). | Only when the publisher sets a message id. See [Reading from RabbitMQ](/concepts/triggers#reading-from-rabbitmq). |

## Good to know

- **Every message may run more than once.** A worker that stops mid-run, or a
  rebalance between workers, means the batch is read again by whoever picks it
  up. Make your workflow safe to repeat — `meta.id` on each event is stable
  across repeats and is the easiest thing to deduplicate on. On RabbitMQ it is
  stable only when the publisher sets a message id.
- **Order.** Kafka keeps order per partition: messages on one partition always
  run in the order they were written, and different partitions run side by
  side, up to the trigger's **Concurrency**. NATS streams have no partitions, so
  messages run in order only when **Concurrency** is 1. SQS keeps no order at
  all unless the queue is FIFO, and even then only among messages sharing the
  same message group ID. RabbitMQ keeps queue order only at a concurrency of 1
  with a single worker.
- **Each trigger reads independently — except on SQS and RabbitMQ.** On Kafka it is its own
  consumer group, and on NATS its own durable consumer, both named
  `fluxify-<trigger id>`, so two triggers on the same topic or stream each get
  every message. SQS has no such concept: two triggers reading the same queue
  split its messages, each message going to only one of them, and so do two
  triggers on the same RabbitMQ queue.
- **A run that outlasts the redelivery window is kept alive.** While a
  workflow is working on a batch, Fluxify keeps telling the broker so it is
  not handed to another worker — NATS's redelivery timer and SQS's visibility
  timeout both work this way. If the worker stops mid-run, the batch comes
  back once that window lapses (about 30 seconds on NATS; SQS's own
  **Visibility timeout** setting). RabbitMQ needs no such signal: a message
  stays with its worker until it is settled or the connection drops, up to the
  broker's consumer timeout.
- **Editing the integration** reconnects its triggers within a few seconds.
  **Deleting** it deletes the triggers that use it.
