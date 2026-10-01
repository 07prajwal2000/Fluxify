---
title: Get Request Cookie
description: Read one cookie from the incoming request.
---

# Get Request Cookie

The **Get Request Cookie** block reads one cookie that the caller's browser sent, like a session id, and passes its value to the next block.

## When to use it

- Read a session or login cookie to find out who is calling.
- Read a small preference the browser stored, like a language.
- Don't use it for cookies you want to send. Use [Set HTTP Cookie](./set-http-cookie.md) for that.
- Don't use it for headers. Use [Get HTTP Header](./get-http-header.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Mode** | No | Single | **Single** handles one value. **Multiple** handles a list of rows, see below. |
| **Name** | Yes | none | The cookie to read. Can be a JS expression. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the cookie's value as text. |

## Example

The browser sent the cookie `session=abc123`.

| Field | Value |
| --- | --- |
| Name | `session` |

The next block receives `"abc123"` as its `input`. A [DB Get Single](./db-get-single.md) can then look up that session.

## Single or Multiple

Pick **Multiple** to read several cookies in one block. Each row has a **Name**.

- The output is an **array** with one value per row, in row order.
- A missing cookie gives `""` for its row. The other rows still work.

With rows `session_id` and `theme`, the next block receives something like `["abc123", "dark"]`.

## How it behaves

- **A missing cookie is empty text.** If the browser didn't send it, the value is `""`. It is not an error.
- **It replaces the flowing data.** The next block's `input` is the cookie value, not what came before. Store earlier data first with [Set Variable](./set-var.md).
- **Read-only.** It never changes the cookie. To change or remove it, use [Set HTTP Cookie](./set-http-cookie.md).

## Related blocks

- [Set HTTP Cookie](./set-http-cookie.md): send a cookie back.
- [Get HTTP Header](./get-http-header.md): read a header.
- [If Condition](./if-condition.md): check whether the cookie exists.
