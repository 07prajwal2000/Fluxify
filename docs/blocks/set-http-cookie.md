---
title: Set HTTP Cookie
description: Send a cookie to the caller's browser with the response.
---

# Set HTTP Cookie

The **Set HTTP Cookie** block stores a cookie in the caller's browser, for example a login session. Your data passes through it untouched.

## When to use it

- Log a user in: store a session id after you checked their password.
- Remember a small preference, like a language or theme.
- Don't put private data in a cookie the page's JavaScript can read. Turn on **HttpOnly** for anything sensitive.
- Don't use it for other headers. Use [Set HTTP Header](./set-http-header.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Name** | Yes | none | The cookie's name. Can be a JS expression. |
| **Value** | Yes | none | What to store. Can be a JS expression. |
| **Expiry** | Yes | none | When the cookie expires, as an ISO date like `2030-01-01T00:00:00Z`. Can be a JS expression. |
| **Domain** | No | the current site | The website domain the cookie belongs to. |
| **Path** | No | `/` | The URL path where the browser sends it. `/` means the whole site. |
| **HttpOnly** | No | off | On: page JavaScript can't read the cookie. Safer for sessions. |
| **Secure** | No | off | On: the browser only sends it over HTTPS. |
| **SameSite** | No | `Strict` | When the cookie is sent with cross-site requests: `Strict`, `Lax` or `None`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives exactly what this block received. |

## Example

Keep a user logged in for 30 days. The previous block produced `{ "sessionId": "abc123" }`.

| Field | Value |
| --- | --- |
| Name | `session` |
| Value | `js: input.sessionId` |
| Expiry | `js: new Date(Date.now() + 30 * 86400000).toISOString()` |
| Path | `/` |
| HttpOnly | on |
| Secure | on |

The response carries `Set-Cookie: session=abc123; ...`. The browser sends it back on later requests, and [Get Request Cookie](./get-request-cookie.md) can read it.

::: info
Set HTTP Cookie has no Multiple mode. A cookie has too many settings to fit in a row. To set several cookies, chain several Set HTTP Cookie blocks.
:::

## How it behaves

- **The cookie is sent with the final response.** Put the block anywhere before the [Response](./response.md) block.
- **Data passes through.** The block does not change `input`.
- **Give a valid date.** Use an ISO date for **Expiry**. A date that can't be read gives a cookie the browser throws away.
- **Same name, new value.** Setting a cookie with an existing name and the same domain and path replaces it.
- **It only works for API routes.** A workflow has no caller to send a cookie to.

## Related blocks

- [Get Request Cookie](./get-request-cookie.md): read a cookie the browser sent.
- [Set HTTP Header](./set-http-header.md): add any other response header.
- [Response](./response.md): sends the final answer, with the cookie.
