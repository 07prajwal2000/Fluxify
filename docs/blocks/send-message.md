---
title: Send Message
description: Publish one message or a list of them to Kafka, NATS JetStream, Amazon SQS or a Redis stream.
---

# Send Message

The **Send Message** block publishes messages from a route or workflow to a message queue: a Kafka topic, a NATS JetStream subject, an Amazon SQS queue, or a Redis stream. It waits until the broker (the queue server) confirms each message, then tells you what was sent.

## When to use it

- Hand work to another service: "order created", "send this email", "resize this image".
- Fan an event out to everything that listens on a topic.
- Feed a [trigger](/concepts/triggers) that starts another workflow from the same queue.
- Don't use it to start one of your own workflows directly. [Trigger Workflow](./trigger-workflow.md) does that with no queue to set up.

::: info Editions
Sending to a **Redis stream** works in every edition. Kafka, NATS and SQS need an enterprise license, the same as their triggers. Saving a block that points at one of them without a license is refused with the same error. A block saved while licensed keeps sending after the license lapses.

**RabbitMQ** can't be picked here yet; for now, a RabbitMQ trigger's workflow can publish through [its channel](/concepts/triggers#the-rabbitmq-channel).
:::

## Inputs

The block has two modes. **Simple** (the default) is a form. **Raw** gives your JavaScript the broker's own client.

### Simple mode

| Field | Tab | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| **Integration** | General | Yes | none | A Kafka, NATS or SQS [message queue integration](/integrations/message-queues), or a [Redis integration](/integrations/kv-stores) to send to a stream. |
| **Destination** | General | Yes | none | Where the message goes inside that integration. See the table below. Supports `js:` expressions. In a list, a message can name its own. |
| **Use Input as Payload** | General | No | off | Send the previous block's output as it is. A list sends one message per item; anything else is one message. The Message tab is hidden. |
| **Messages** | Message | No | Single | **Single** sends one message. **Bulk** sends a list, one message per item. |
| **Payload** | Message | Yes | `{}` | The message, as JSON (values support `js:`) or as JavaScript code that returns it. |
| **Key** | Options | No | none | Kafka only. Messages with the same key go to the same partition, in order. |
| **Headers** | Options | No | none | Kafka and NATS headers, or SQS message attributes. Redis streams have none. |
| **Go to Error When** | Options | No | All messages fail | For a list only. Decides when the Failure path runs. See [Outputs](/blocks/send-message#outputs). |
| **Save output to variable** | | No | off | Store the output in `outputs.<name>`, on either path. |

What to put in **Destination**:

| Broker | Destination is | Example |
| --- | --- | --- |
| Kafka | A topic name | `orders` |
| NATS | A subject that one of your JetStream streams listens on | `orders.created` |
| SQS | The queue's full URL | `https://sqs.us-east-1.amazonaws.com/123456789012/orders` |
| Redis | The stream's key. The stream is created on the first message. | `orders` |

::: tip Sending a list as one message
With **Use Input as Payload** on, a list always becomes one message per item. To send a whole list as one message, turn it off, keep **Messages** on **Single**, and set the payload to JavaScript: `return input`.
:::

Broker options, also on the **Options** tab. The **Name** is what to use when a message in a list sets its own (see [Lists of messages](/blocks/send-message#lists-of-messages)).

| Broker | Option | Name | What it does |
| --- | --- | --- | --- |
| Kafka | **Partition** | `partition` | Send to this partition. Blank lets Kafka pick from the key. |
| Kafka | **Timestamp** | `timestamp` | Milliseconds since 1970, or a date. Blank is now. |
| NATS | **Message ID** | `msgId` | JetStream drops a second message with the same ID inside the stream's duplicate window. |
| SQS | **Delay (seconds)** | `delaySeconds` | Hide the message for 0 to 900 seconds. Not for FIFO queues. |
| SQS | **Message Group ID** | `groupId` | Required by FIFO queues. Messages in one group are delivered in order. |
| SQS | **Deduplication ID** | `deduplicationId` | FIFO queues without content-based deduplication need one. |
| Redis | **Max Length** | `maxLen` | Trim the stream to about this many entries. Blank keeps everything. |

### Raw mode

Use Raw mode when the form can't do what you need, such as a broker feature it has no field for.

| Field | Tab | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| **Integration** | General | Yes | none | As in Simple mode. |
| **Code** | Code | Yes | none | JavaScript with a `client` object, the broker's own client, already connected. It must `return` the result. The editor knows the client's types, so you get autocomplete. |

| Broker | `client` is |
| --- | --- |
| Kafka | A `@platformatic/kafka` producer with text keys and values, waiting for all in-sync replicas. |
| NATS | A JetStream client from `@nats-io/jetstream`. |
| SQS | The `SQS` client from `@aws-sdk/client-sqs`, with methods like `sendMessage`. |
| Redis | An `ioredis` client. |

## Outputs

| Handle | Runs when | Input to the next block |
| --- | --- | --- |
| **Success** (right) | The broker accepted the message. For a list, see below. | What the broker reported. |
| **Failure** (right, red) | The send failed. | `{ error }`, or for a list the full report. |

What the broker reports for one message:

| Broker | Output |
| --- | --- |
| Kafka | `{ topic, partition, offset }` |
| NATS | `{ stream, seq, duplicate }` |
| SQS | `{ queueUrl, messageId, sequenceNumber }` (sequence number on FIFO queues only) |
| Redis | `{ stream, id }` |

For a list, the output lists every message by its position in your list:

```json
{
  "sent": [{ "index": 0, "topic": "orders", "partition": 1, "offset": "8812" }],
  "failed": [{ "index": 1, "error": "Topic not found" }]
}
```

A list is not all-or-nothing: messages that went through stay sent. The **Go to Error When** option decides which path runs:

| Go to Error When | Success runs | Failure runs |
| --- | --- | --- |
| **All messages fail** (default) | At least one message was sent, or the list was empty. | Every message failed. |
| **Any message fails** | Every message was sent. | Even one message failed. |

If you leave **Failure** unconnected, a failure goes to the [Error Handler](./error-handler.md) instead, like any other block's error.

## Example

Publish an order to Kafka after saving it, keyed by customer so one customer's orders stay in order.

- **Destination**: `orders`
- **Use Input as Payload**: on (the previous block returns the saved order)
- **Key**: `js:return input.customerId`

The next block receives `{ "topic": "orders", "partition": 2, "offset": "8813" }`.

Send a list of reminders to SQS, one of them to a different queue. Set **Destination** to the main queue's URL and turn on **Use Input as Payload**. The previous block returns:

```json
[
  { "userId": 1 },
  { "userId": 2 },
  { "payload": { "userId": 3 }, "destination": "https://sqs.us-east-1.amazonaws.com/123456789012/vip" }
]
```

Users 1 and 2 go to the main queue, user 3 to the `vip` queue. The next block receives a report like the one under [Outputs](/blocks/send-message#outputs).

## How it behaves

### What gets sent

| Payload | Sent as |
| --- | --- |
| Text | The text, unchanged. |
| Number or true/false | Its text, e.g. `42`. A Fluxify trigger reads it back as a number or true/false. |
| Object or list | JSON. |
| BigInt (large whole numbers from a database) | Its digits as a JSON string, e.g. `"9007199254740993"`, so no digits are lost. |
| Function, symbol, `undefined`, or an object that contains itself | Not sent. The message fails with the reason. |

::: warning Text that looks like JSON
A Fluxify trigger tries to read every message as JSON. So the text `"42"` or `"true"` comes back as the number 42 or true. If it must stay text, send an object like `{ "value": "42" }`.
:::

On **Redis**, a stream entry holds named fields, not one body. An object's keys become the fields, and each value is sent as above. Anything else is sent in one field called `data`. A Redis Streams trigger hands the fields back as text.

### Lists of messages

- Each item in the list is one message, and the item is the payload.
- To give one message its own settings, wrap it: `{ "payload": ..., "destination": ..., "key": ..., "headers": {...} }`, plus any broker option by its **Name** from the table above, such as `"partition"` or `"groupId"`. These override the block's settings for that message only. Headers are merged with the block's.
- Every message gets its own result, so one bad message doesn't stop the others.
- You don't need to split large lists. SQS takes at most 10 messages or 256 KB per request, so the block sends in chunks of that size for you.

### Waiting and timeouts

- The block always waits for the broker to confirm, and never retries on its own.
- It waits up to the integration's **Send timeout**, 30 seconds by default. After that the send fails with "No answer from the broker". A message that timed out may still have arrived.
- One connection per integration is shared by every run on a worker. Editing the integration reconnects. In Raw mode, `client.close()` and similar methods are refused for this reason.

## Raw examples

Kafka:

```javascript
const result = await client.send({
  messages: [{ topic: "orders", key: "42", value: JSON.stringify({ id: 42 }) }],
});
return result.offsets;
```

NATS:

```javascript
const ack = await client.publish("orders.created", JSON.stringify({ id: 42 }));
return { stream: ack.stream, seq: ack.seq };
```

SQS:

```javascript
const sent = await client.sendMessage({
  QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
  MessageBody: JSON.stringify({ id: 42 }),
});
return sent.MessageId;
```

Redis:

```javascript
return await client.xadd("orders", "*", "id", "42", "status", "new");
```

## Related blocks

- [Trigger Workflow](./trigger-workflow.md): start one of your own workflows, no queue needed.
- [HTTP Request](./http-request.md): call a service that has an HTTP API instead.
- [KV Raw Connection](./kv-raw.md): any other Redis command.
