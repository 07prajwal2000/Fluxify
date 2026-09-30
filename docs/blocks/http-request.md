---
title: HTTP Request
description: Call an external web service or API and use its answer.
---

# HTTP Request

The **HTTP Request** block sends a request to another web service, waits for the answer, and passes that answer on. Use it to fetch data from an API or to send data to one.

## When to use it

- Read data from a third-party API, like weather, payments or a CRM.
- Tell another service something happened: post to a webhook, create a record, start a job.
- Don't use it to start another Fluxify workflow. [Trigger Workflow](./trigger-workflow.md) does that without a network call.
- Don't use it to read your own database. The [DB blocks](./db-get-all.md) are faster and safer for that.

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **URL** | Yes | none | The address to call. Can be a JS expression, for example `js: 'https://api.example.com/users/' + input.id`. |
| **Method** | Yes | none | `GET`, `POST`, `PUT`, `DELETE` or `PATCH`. |
| **Headers** | No | none | Extra information sent with the request, like an `Authorization` token. Names and values can be JS expressions. |
| **Body** | No | empty | The data to send. Only used by `POST`, `PUT` and `PATCH`. Values inside can be JS expressions. |
| **Use Param** | No | off | On: send the previous block's output as the body, instead of the **Body** field. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

Use [App Config](../concepts/app-config.md) for secrets like API keys, instead of typing them into a header.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | The request succeeded. The next block receives `{ data, status }`. |

| Field | What it holds |
| --- | --- |
| `data` | The answer's body. JSON is already turned into an object or list. |
| `status` | The HTTP status code, for example `200`. |

## Example

Look up a user from an API. The previous block output `{ "id": 7 }`.

| Field | Value |
| --- | --- |
| URL | `js: 'https://api.example.com/users/' + input.id` |
| Method | `GET` |
| Headers | `Authorization` = `js: 'Bearer ' + getConfig('API_KEY')` |

Result passed to the next block:

```json
{ "data": { "id": 7, "name": "Avery" }, "status": 200 }
```

Use `input.data.name` in the next block.

## How it behaves

- **A failed call is an error.** A network problem, or an answer with an error status like `404` or `500`, fails the block. The [Error Handler](./error-handler.md) runs instead of **Next**.
- **Only success continues.** To react to a specific status, let the Error Handler take over, or call the API from a [JS Runner](./js-runner.md) and check the status yourself.
- **JSON text is parsed.** If the body is text that is valid JSON, it is sent as JSON.
- **No timeout of its own.** The call waits as long as the route's own timeout allows.
- **A relative URL** like `/health` is sent to `http://localhost:3000`, which is usually not what you want. Use the full address.
- **Your previous data is replaced.** The next block's `input` is the response, not what came before. Use **Save output to variable** or [Set Variable](./set-var.md) to keep earlier data.

## Related blocks

- [Get Variable](./get-var.md) and [Set Variable](./set-var.md): keep data across steps.
- [Transformer](./transformer.md): reshape the answer.
- [For Each Loop](./foreach-loop.md): call an API once per item.
- [Orchestrator](./orchestrator.md): call several APIs at the same time.
- [Error Handler](./error-handler.md): decide what happens when a call fails.
