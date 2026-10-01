---
title: Get HTTP Header
description: Read one header from the incoming request.
---

# Get HTTP Header

The **Get HTTP Header** block reads one header from the request that started the flow, like `Authorization` or `User-Agent`, and passes its value to the next block.

## When to use it

- Read an API key or token that the caller sent.
- Check what kind of client is calling, with `User-Agent` or `Accept-Language`.
- Don't use it for data in the URL. Use [Get HTTP Param](./get-http-param.md) for that.
- Don't use it for data in the body. Use [Get HTTP Request Body](./get-http-request-body.md).
- Don't use it for cookies. Use [Get Request Cookie](./get-request-cookie.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Mode** | No | Single | **Single** handles one value. **Multiple** handles a list of rows, see below. |
| **Name** | Yes | none | The header to read. Can be a JS expression. Capital letters don't matter: `Authorization` and `authorization` are the same header. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the header's value as text. |

## Example

The caller sent `Authorization: Bearer abc123`.

| Field | Value |
| --- | --- |
| Name | `Authorization` |

The next block receives `"Bearer abc123"` as its `input`.

## Single or Multiple

Pick **Multiple** to read several headers in one block. Each row has a **Name**.

- The output is an **array** with one value per row, in row order.
- A missing header gives `""` for its row. The other rows still work.

With rows `Authorization` and `User-Agent`, the next block receives something like `["Bearer abc123", "curl/8.4.0"]`.

## How it behaves

- **A missing header is empty text.** If the caller didn't send it, the value is `""`. It is not an error. Check it with an [If Condition](./if-condition.md) using **Is Empty/Null**.
- **It replaces the flowing data.** The next block's `input` is the header value, not what came before. To keep earlier data, store it first with [Set Variable](./set-var.md).
- **Read-only.** It never changes the request.

## Related blocks

- [Get Request Cookie](./get-request-cookie.md): read a cookie instead.
- [Get HTTP Param](./get-http-param.md): read a query or path value.
- [Set HTTP Header](./set-http-header.md): add a header to the response.
- [If Condition](./if-condition.md): react to a missing or wrong value.
