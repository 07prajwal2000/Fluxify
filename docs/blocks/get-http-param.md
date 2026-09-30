---
title: Get HTTP Param
description: Read a value from the URL, either a query parameter or a path parameter.
---

# Get HTTP Param

The **Get HTTP Param** block reads one value from the request's URL and passes it to the next block. It can read a query parameter (`?page=2`) or a part of the path (`/users/123`).

## When to use it

- Read an id from the path, like `123` in `/users/123`.
- Read options from the query string, like `page`, `limit` or `search`.
- Don't use it for data sent in the body. Use [Get HTTP Request Body](./get-http-request-body.md).
- Don't use it for headers or cookies. Use [Get HTTP Header](./get-http-header.md) or [Get Request Cookie](./get-request-cookie.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Name** | Yes | none | The name of the parameter. Can be a JS expression. |
| **Source** | Yes | none | `query`: look after the `?` in the URL. `path`: look in the route's path parameters. |

For `path`, the name is the one you gave the route, for example `id` for a route like `/users/:id`.

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the value as text. |

## Example

The route is `/users/:id` and the caller requests `/users/123?verbose=true`.

| Name | Source | The next block receives |
| --- | --- | --- |
| `id` | `path` | `"123"` |
| `verbose` | `query` | `"true"` |

## How it behaves

- **Always text.** `"123"` is not the number `123`. Convert it with a [Transformer](./transformer.md) or JS when you need a number.
- **A missing value is empty text.** If the parameter isn't there, the value is `""`. It is not an error.
- **It replaces the flowing data.** The next block's `input` is the value, not what came before. Store earlier data first with [Set Variable](./set-var.md).
- **Wrong source, empty result.** A path parameter read with **Source** `query` (or the other way round) comes back empty.

## Related blocks

- [Get HTTP Request Body](./get-http-request-body.md): read data sent in the body.
- [Get HTTP Header](./get-http-header.md): read a header.
- [If Condition](./if-condition.md): check that a required value is present.
- [DB Get Single](./db-get-single.md): look up a record by the id you just read.
