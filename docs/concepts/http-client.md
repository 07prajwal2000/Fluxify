---
title: HTTP Client
description: Call external HTTP APIs from a route with the HTTP Request block or JavaScript helper.
---

# HTTP Client

Use Fluxify's HTTP client when a route needs to call another API: enrich a response, send a webhook, check a third-party service, or pass data to another internal service.

There are two ways to make an outbound request:

| Choose | When it fits best |
| --- | --- |
| **HTTP Request block** | The request shape is easy to express on the canvas and you want its response to flow to the next block. |
| **`httpClient` in JavaScript** | You need custom branching, dynamic request construction, or several calls inside a script. |

Both use the same route runtime. They are for outbound calls; they do not describe the HTTP request that triggered your Fluxify route.

## HTTP Request block

Configure the URL, HTTP method, headers, and—where applicable—a request body. The block waits for the remote server and passes its response to the next block as `input`.

Use JavaScript values in fields when part of the request comes from the current route, for example a route parameter, body field, or App Config value. This is a good choice for a clear, single API call in the middle of a visual route.

## Use `httpClient` in a script

`httpClient` is available globally in JS Runner and other supported scripting fields. Its methods are asynchronous, so await the response before using it.

```javascript
const apiKey = getConfig("CUSTOMER_API_KEY");
const response = await httpClient.get(
  `https://api.example.com/customers/${getRouteParam("id")}`,
  { Authorization: `Bearer ${apiKey}` }
);

return response.data;
```

### Available methods

| Method | Use it for |
| --- | --- |
| `httpClient.get(url, headers?)` | Fetching a resource. |
| `httpClient.post(url, data?, headers?)` | Creating a resource or sending an action. |
| `httpClient.put(url, data?, headers?)` | Replacing a resource. |
| `httpClient.patch(url, data?, headers?)` | Partially updating a resource. |
| `httpClient.delete(url, headers?)` | Deleting a resource. |

Headers are a simple key-value object. For methods with a body, pass the body as the second argument and headers as the third:

```javascript
const response = await httpClient.post(
  "https://api.example.com/events",
  { type: "user.updated", userId: input.id },
  { Authorization: `Bearer ${getConfig("EVENTS_API_KEY")}` }
);

return { status: response.status, event: response.data };
```

Each successful call returns a response object. Most routes use `response.data`; `response.status`, `response.statusText`, and `response.headers` are also available when the route needs them.

For exact parameter and return types, see the [HTTP client API reference](../scripting/javascript-api.md#http-client).

## Handling failures

An unreachable service, timeout, or unsuccessful HTTP response makes the call fail. Let the route's **Error Handler** produce a controlled response, or catch an expected failure in JavaScript when the route has a useful fallback.

```javascript
try {
  const response = await httpClient.get("https://api.example.com/status");
  return response.data;
} catch (error) {
  logger.logWarn("Status service unavailable", error);
  return { available: false };
}
```

Avoid swallowing failures that callers need to know about. In those cases, let the error continue to the route's Error Handler instead.

## Good practices

- Store API keys and base URLs in [App Config](./app-config.md), not in scripts or block fields.
- Pass only the headers the remote service needs; never forward all inbound headers by default.
- Keep external calls bounded and avoid unnecessary sequential requests. A slow remote API is part of your route's response time.
- Return only the data your route's caller needs rather than relaying an entire third-party response by default.

## Related pages

- [JavaScript API Reference — HTTP client](../scripting/javascript-api.md#http-client)
- [HTTP Request block](../blocks/http-request.md)
- [Error Handler block](../blocks/error-handler.md)
