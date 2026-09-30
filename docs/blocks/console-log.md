---
title: Console Log
description: Print a message to the server logs, for debugging and simple monitoring.
---

# Console Log

The **Console Log** block prints a message to the server's log output. Use it to see what your flow is doing while you build it, or to leave a simple trail in production. Your data passes through it untouched.

## When to use it

- Check what a value looks like at some point in the flow while you debug.
- Note that something happened, like "order paid" or "retrying".
- Don't use it to send logs to an external service. Use [Cloud Logs](./cloud-logs.md).
- Don't log secrets, passwords or full personal data. Anyone who can read the server logs can read them.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Message** | No | the incoming value | The text or data to print. Can be a JS expression, for example `js: "Order " + input.id + " paid"`. Leave it empty to print whatever reached the block. |
| **Level** | No | `info` | How serious the message is: `info`, `warn` or `error`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives exactly what this block received. |

## Example

Log the order id as a warning when a payment is retried. The previous block output `{ "id": 42 }`.

| Field | Value |
| --- | --- |
| Message | `js: "Retrying payment for order " + input.id` |
| Level | `warn` |

The server log shows something like:

```text
WARN-/orders/pay-2026-03-01 09:30:12
Retrying payment for order 42
```

The next block still receives `{ "id": 42 }`.

## How it behaves

- **Each line starts with a header.** It has the level, the route, and the date and time, then the message on the next line.
- **Objects are printed as readable JSON.** A message that is an object or a list is shown indented over several lines.
- **The message you type wins.** When **Message** is filled in, the incoming value is not printed. When it is empty, the incoming value is.
- **It never changes your data,** and it does not fail the flow.
- **Who can see it.** The message goes to the server's own log output, not to the caller.

## Related blocks

- [Cloud Logs](./cloud-logs.md): send the same message to an external log service.
- [Error Handler](./error-handler.md): log a failure before you answer.
- [JS Runner](./js-runner.md): log from code with `logger`.
