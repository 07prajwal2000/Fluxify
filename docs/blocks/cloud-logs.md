---
title: Cloud Logs
description: Send a log message to an external log service such as Loki or OpenTelemetry.
---

# Cloud Logs

The **Cloud Logs** block sends a message to the log service you connected, like Loki or an OpenTelemetry collector. Use it to keep logs in one central place where you can search them and set alerts. Your data passes through it untouched.

## When to use it

- Keep production logs somewhere searchable, instead of only on the server.
- Record business events you want to alert on, like failed payments.
- Don't use it for quick debugging while you build. [Console Log](./console-log.md) is simpler and needs no setup.
- Don't log secrets, passwords or full personal data. They end up in a system that other people can search.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Connection** | Yes | none | The log service integration to send to. Set one up first, see [Observability](/integrations/observability). |
| **Message** | No | the incoming value | The text or data to send. Can be a JS expression, for example `js: "Payment failed for " + input.orderId`. Leave it empty to send whatever reached the block. |
| **Level** | No | `info` | How serious the message is: `info`, `warn` or `error`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives exactly what this block received. |

## Example

Record a failed payment as an error. The previous block output `{ "orderId": 42, "reason": "card_declined" }`.

| Field | Value |
| --- | --- |
| Connection | `loki-prod` |
| Message | `js: "Payment failed for order " + input.orderId + ": " + input.reason` |
| Level | `error` |

Your log service receives an `error` entry with the text `Payment failed for order 42: card_declined`. The next block still receives the original object.

## How it behaves

- **The message you type wins.** When **Message** is filled in, the incoming value is not sent. When it is empty, the incoming value is.
- **A missing or wrong connection is an error.** The block fails and the [Error Handler](./error-handler.md) runs.
- **It never changes your data.**

## Related blocks

- [Console Log](./console-log.md): print to the server's own logs.
- [Error Handler](./error-handler.md): send a failure to the log service before you answer.
- [JS Runner](./js-runner.md): log from code with `logger`.
