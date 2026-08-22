# Fluxify JavaScript API

## How scripts run

JavaScript can run in a JS Runner block, a Transformer block, or a `js:` field expression.

- Fluxify includes the script in the route's JavaScript handler.
- The handler receives the current request and workflow context.
- The runtime is Bun, not Node.js. Bun APIs are available, and many Node.js-compatible built-in imports also work.
- A JS Runner or Transformer script returns the output for the next block.
- A `js:` expression evaluates to the value required by its field.
- Synchronous code and `async`/`await` are supported.
- Imports are resolved when the route is prepared, not repeated for each request.

Every JS Runner and Transformer script must return a value. Return `input` when the script only performs a side effect.

Node.js-compatible imports run inside the Bun worker that handles the route. Use them only when they are needed: synchronous filesystem work, CPU-heavy processing, child-process work, or other unnecessary blocking operations can delay request handling in that worker.

## Request values

```javascript
const id = getRouteParam("id");
const page = Number(getQueryParam("page") || 1);
const body = getRequestBody();

return {
  id,
  page,
  method: httpRequestMethod,
  path: httpRequestRoute,
  body,
};
```

Available request APIs:

- `input`: output from the previous block.
- `httpRequestMethod`: incoming HTTP method.
- `httpRequestRoute`: incoming request path.
- `getQueryParam(key)`: query parameter or `""` when absent.
- `getRouteParam(key)`: route parameter or `""` when absent.
- `getHeader(key)`: incoming header or `""` when absent.
- `getCookie(key)`: incoming cookie or `""` when absent.
- `getRequestBody()`: parsed request body.

## Dynamic field values

Fields that support dynamic JavaScript accept a `js:` expression. The expression must evaluate to the field value.

Examples: `js: input.userId`, `js: getQueryParam("page")`, and `js: getConfig("API_BASE_URL")`.

## Response helpers

Use response helpers before returning the result:

```javascript
setHeader("content-type", "application/json");
setCookie("session", {
  value: String(input.sessionId),
  httpOnly: true,
  secure: true,
  path: "/",
});

return { ok: true, data: input };
```

- `setHeader(key, value)` adds an outgoing response header.
- `setCookie(name, options)` adds an outgoing cookie. Options include `value`, `domain`, `path`, `expiry`, `httpOnly`, `secure`, and `samesite`.

## Configuration and request state

```javascript
const apiBaseUrl = getConfig("API_BASE_URL");
const userId = getRouteParam("id");

requestUserId = userId;
return { apiBaseUrl, userId };
```

- `getConfig(key)` reads a project App Config value.
- Values assigned to runtime variables are available to later blocks in the same request.
- Runtime variables are not shared between requests.

## JWT

```javascript
const token = getHeader("Authorization").replace(/^Bearer\\s+/i, "");
const secret = getConfig("JWT_SECRET");

if (!token || typeof secret !== "string") {
  return { authenticated: false };
}

const result = jwt.verify(token, secret);
return {
  authenticated: result.success,
  user: result.success ? result.payload : null,
};
```

- `jwt.sign(payload, secretKey, options?)` returns a token string.
- `jwt.verify(token, secretKey, options?)` returns `{ success, payload }`.
- `jwt.decode(token, options?)` returns a payload without signature verification.

## Outgoing HTTP

```javascript
const city = getQueryParam("city") || "London";
const response = await httpClient.get(
  `https://api.example.com/weather?city=${encodeURIComponent(city)}`,
);

return {
  status: response.status,
  data: response.data,
};
```

Available methods are `get`, `post`, `put`, `patch`, and `delete`. Each returns a promise with `data`, `status`, `statusText`, `headers`, and `config`.

## Logging and bundled libraries

```javascript
logger.logInfo({ userId: input.userId, action: "load-profile" });

const activeUsers = libs._.filter(input.users || [], (user) => user.active);
const timestamp = libs.dayjs().toISOString();

return { activeUsers, timestamp };
```

- `logger.logInfo(value)`, `logger.logWarn(value)`, and `logger.logError(value)` write structured logs.
- `libs.dayjs` provides date and time helpers.
- `libs._` provides Underscore utilities.
- `libs.zod` provides schema validation.

## Database SQL

`dbQuery(query)` is available only in a DB Native block:

```javascript
const rows = await dbQuery("SELECT id, name FROM users LIMIT 20");
return rows;
```

## Imports

Use standard static imports for supported runtime modules and bundled libraries:

```javascript
import { randomUUID } from "crypto";

return { id: randomUUID() };
```

Use static `import` statements for supported Bun, Node.js-compatible, and bundled modules. For example:

```javascript
import { randomUUID } from "node:crypto";

return { id: randomUUID() };
```

`require()` is not supported, and imported names must not replace context names such as `input`, `jwt`, `logger`, or `httpClient`.

## Error-safe script example

```javascript
try {
  const response = await httpClient.get("https://api.example.com/data");
  return { ok: true, data: response.data };
} catch (error) {
  logger.logError({ message: String(error) });
  return { ok: false, error: "External request failed" };
}
```
