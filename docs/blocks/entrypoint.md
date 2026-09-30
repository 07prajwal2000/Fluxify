---
title: Entrypoint
description: The block every workflow starts from. It hands the incoming data to the first real block.
---

# Entrypoint

The **Entrypoint** block is where every run begins. It takes the data that started the run (an API request body, or the payload of a workflow) and passes it on, unchanged, to the next block.

## When to use it

- You don't add it yourself. Every route and workflow already has exactly one, and you connect your first block to it.
- Don't try to add logic here. It has no settings. Put your first real step (a check, a database call, a variable) right after it.

## Inputs

None. There is nothing to configure.

The data it receives depends on how the run started:

| Started by | What the Entrypoint passes on (`input`) |
| --- | --- |
| An API route | The request body. Empty for a request without one, like most `GET` calls. |
| A workflow, run by a trigger or by you | The payload the workflow was given. |
| A trigger with one event | That event's payload. With several events, a list of payloads. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives exactly what the Entrypoint received. |

It has no input handle, because nothing runs before it.

## Example

A `POST /orders` route receives this body:

```json
{ "orderId": "A-1024", "total": 40 }
```

The block connected to **Next** gets that same object as its `input`, so it can read `input.total`.

## How it behaves

- It never fails and never changes the data.
- There can be only one Entrypoint on a canvas.
- Request details that are not in the body (headers, cookies, query parameters) are not in `input`. Read them with [Get HTTP Header](./get-http-header.md), [Get Request Cookie](./get-request-cookie.md) or [Get HTTP Param](./get-http-param.md).

## Related blocks

- [Get HTTP Request Body](./get-http-request-body.md): read the body from anywhere later in the flow.
- [Response](./response.md): ends the flow and sends the result back.
- [Error Handler](./error-handler.md): decides what happens when something fails.
