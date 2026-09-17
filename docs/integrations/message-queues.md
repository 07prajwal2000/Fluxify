---
title: Message Queue Integrations
description: Start workflows from messages on a Kafka topic, a NATS JetStream stream, or an AWS SQS queue.
---

# Message Queue Integrations

A message queue integration lets a [trigger](/concepts/triggers) start a
workflow every time messages arrive on a Kafka topic, a NATS stream, or an AWS
SQS queue. The integration holds the connection details; the trigger says what
to read and which workflow to run.

::: info Enterprise
Kafka, NATS and SQS triggers need an enterprise license. Creating one is
refused until a license is active.
:::

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

## Good to know

- **Every message may run more than once.** A worker that stops mid-run, or a
  rebalance between workers, means the batch is read again by whoever picks it
  up. Make your workflow safe to repeat — `meta.id` on each event is stable
  across repeats and is the easiest thing to deduplicate on.
- **Order.** Kafka keeps order per partition: messages on one partition always
  run in the order they were written, and different partitions run side by
  side, up to the trigger's **Concurrency**. NATS streams have no partitions, so
  messages run in order only when **Concurrency** is 1. SQS keeps no order at
  all unless the queue is FIFO, and even then only among messages sharing the
  same message group ID.
- **Each trigger reads independently — except on SQS.** On Kafka it is its own
  consumer group, and on NATS its own durable consumer, both named
  `fluxify-<trigger id>`, so two triggers on the same topic or stream each get
  every message. SQS has no such concept: two triggers reading the same queue
  split its messages, each message going to only one of them.
- **A run that outlasts the redelivery window is kept alive.** While a
  workflow is working on a batch, Fluxify keeps telling the broker so it is
  not handed to another worker — NATS's redelivery timer and SQS's visibility
  timeout both work this way. If the worker stops mid-run, the batch comes
  back once that window lapses (about 30 seconds on NATS; SQS's own
  **Visibility timeout** setting).
- **Editing the integration** reconnects its triggers within a few seconds.
  **Deleting** it deletes the triggers that use it.
