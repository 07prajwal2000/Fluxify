# Fluxify Execution Context

## Core behavior

- Fluxify creates one fresh execution context for each HTTP request.
- The context is discarded when the request finishes and is isolated from other requests.
- Blocks and scripts use the context to read request data, pass values, store temporary state, and shape the response.
- Route JavaScript runs in Bun, not Node.js. Bun supports many Node.js-compatible imports, but the available runtime APIs are Bun APIs.

## Available values and helpers

| Name | Available data or behavior |
| --- | --- |
| `input` | Output of the previous block. The next block receives the current block's returned value as `input`. |
| `httpRequestMethod` | Incoming HTTP method, such as `GET` or `POST`. |
| `httpRequestRoute` | Incoming request path. |
| `getQueryParam(key)` | Reads a query parameter; returns an empty string when absent. |
| `getRouteParam(key)` | Reads a named route parameter; returns an empty string when absent. |
| `getHeader(key)` | Reads an incoming header; lookup is case-insensitive. |
| `getCookie(key)` | Reads an incoming cookie. |
| `getRequestBody()` | Reads the parsed request body. |
| Runtime variables | Values assigned during the request and read by later blocks. |
| `getConfig(key)` | Reads a project App Config value or returns `undefined` when it is not configured. |
| `setHeader(key, value)` | Adds a header to the outgoing response. |
| `setCookie(name, options)` | Adds a cookie to the outgoing response. |
| `logger` | Structured logging with `logInfo`, `logWarn`, and `logError`. |
| `httpClient` | Makes outgoing HTTP requests from JavaScript. |
| `jwt` | Signs, verifies, and decodes JSON Web Tokens. |
| `libs` | Provides bundled `dayjs`, Underscore, and Zod libraries. |
| `dbQuery(query)` | Runs SQL inside a DB Native block only. |

## Data flow

1. The Entrypoint receives the HTTP request.
2. Each active block reads its settings and current `input`.
3. The block produces an output.
4. The output becomes `input` for the next connected block.
5. A Response block sends the final result to the caller.

Example:

```javascript
const id = getRouteParam("id");
setHeader("x-route", "users");
return { id, previous: input };
```

Runtime variables are request-local. Use them when multiple later blocks need the same value; use `input` for the value moving through the active path.

## Script return rule

JS Runner and Transformer code must return the value that downstream blocks should receive. A script that only performs a side effect still returns a value:

```javascript
logger.logInfo({ requestId: getHeader("x-request-id") });
return input;
```

For exact function signatures and examples, use the [JavaScript API Reference](../scripting/javascript-api.agent.md).
