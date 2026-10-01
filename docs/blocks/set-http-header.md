---
title: Set HTTP Header
description: Add a header to the response that goes back to the caller.
---

# Set HTTP Header

The **Set HTTP Header** block adds one header to the response, like `Cache-Control` or `X-Request-Id`. Your data passes through it untouched.

## When to use it

- Tell the caller or a cache how to treat the answer: `Cache-Control`, `Content-Language`.
- Add your own tracking header, like `X-Request-Id`.
- Don't use it for cookies. Use [Set HTTP Cookie](./set-http-cookie.md).
- Don't use it to send a header to another service. Put it in the **Headers** field of [HTTP Request](./http-request.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Mode** | No | Single | **Single** handles one value. **Multiple** handles a list of rows, see below. |
| **Name** | Yes | none | The header name, for example `Cache-Control`. Can be a JS expression. |
| **Value** | Yes | none | The header value, for example `no-store`. Can be a JS expression. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives exactly what this block received. |

## Example

Stop caches from keeping the answer.

| Name | Value |
| --- | --- |
| `Cache-Control` | `no-store` |

The response that the [Response](./response.md) block sends carries the header `Cache-Control: no-store`.

## Single or Multiple

Pick **Multiple** to set several response headers in one block. Each row has a **Name** and a **Value**.

- Rows run from top to bottom. `input` is the previous block's output for every row.
- If two rows use the same name, the later row wins.
- The block still passes its `input` through unchanged, as in Single mode.

| Name | Value |
| --- | --- |
| `Cache-Control` | `no-store` |
| `X-Request-Id` | `js:return input.id;` |

## How it behaves

- **The header is sent with the final response.** Put the block anywhere before the [Response](./response.md) block.
- **Data passes through.** The block does not change `input`.
- **Setting the same name again replaces the earlier value.**
- **It only works for API routes.** A workflow has no caller to send a header to.

## Related blocks

- [Set HTTP Cookie](./set-http-cookie.md): send a cookie.
- [Response](./response.md): sends the final answer, with the headers you set.
- [Get HTTP Header](./get-http-header.md): read a header from the request.
