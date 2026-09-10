---
title: Message Queue Integrations
description: Start workflows from messages on a Kafka topic.
---

# Message Queue Integrations

A message queue integration lets a [trigger](/concepts/triggers) start a
workflow every time messages arrive on a topic. The integration holds the
connection details; the trigger says which topics to read and which workflow
to run.

::: info Enterprise
Kafka triggers need an enterprise license. You can add the integration without
one, but creating a Kafka trigger is refused until a license is active.
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

## What happens to each message

A message is marked done — **committed** — once the workflow run that received
it succeeds. After a restart, reading carries on from the last committed
message, so nothing is skipped.

If the run fails, the same batch is run again, up to the trigger's **Max
attempts**, with **Retry delay** between tries. What happens after the last
attempt depends on the dead-letter topic:

| Dead-letter topic | After the last failed attempt |
|---|---|
| **Set** | The messages are copied to the dead-letter topic and then committed. The trigger moves on to the next messages. |
| **Not set** | The messages are not committed. The trigger keeps retrying them, and the messages behind them on the same partition wait. |

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

## Good to know

- **Every message may run more than once.** A worker that stops mid-run, or a
  rebalance between workers, means the batch is read again by whoever picks it
  up. Make your workflow safe to repeat — `meta.id` on each event is stable
  across repeats and is the easiest thing to deduplicate on.
- **Order is kept per partition.** Messages on one partition always run in the
  order they were written. Different partitions run side by side, up to the
  trigger's **Concurrency**.
- **Each trigger is its own consumer group**, named `fluxify-<trigger id>`, so
  two triggers on the same topic each get every message.
- **Editing the integration** reconnects its triggers within a few seconds.
  **Deleting** it deletes the triggers that use it.
