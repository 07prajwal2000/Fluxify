---
title: JS Runner
description: Execute custom JavaScript compiled into the native Bun route handler with full access to the scripting context.
---

# JS Runner

The **JS Runner** block lets you write arbitrary JavaScript code inside your workflow. It is the most flexible block available — use it for custom business logic, data transformation, conditional branching preparation, or anything that standard blocks don't cover.

## Inputs

| Field | Description |
| :--- | :--- |
| **Value** | The JavaScript code to execute. Supports full ES6+ syntax and `async/await`. |
## How It Works

1. The block receives the output of the previous block as its `input` value.
2. When the workflow is saved, the DAG compiler emits the block's code into the native JavaScript route handler.
3. Static imports are discovered by the AST parser and hoisted at compile time, so they are not re-imported per request.
4. All [scripting context](../scripting/context.md) globals (`getHeader`, `logger`, `jwt`, `dayjs`, etc.) are available in the generated handler.
5. Whatever your code `return`s becomes the block's `output`, which is passed to the next block as `input`.
6. If an exception is thrown, the block returns `successful: false` and stops the chain (unless the next block is an Error Handler).

> The JS Runner always sets `continueIfFail: true` on success, meaning the workflow will proceed even if `output` is `null` or `undefined`.
## Available Globals

Inside your JS Runner code, all of the following are available without any import or prefix:

| Global | Description |
| :--- | :--- |
| `input` | Output of the previous block. |
| `getQueryParam(key)` | Read a URL query parameter. |
| `getRouteParam(key)` | Read a route path parameter (e.g., `:id`). |
| `getHeader(key)` | Read an incoming request header. |
| `getCookie(key)` | Read an incoming cookie. |
| `getRequestBody()` | Read the parsed request body. |
| `httpRequestMethod` | The HTTP method (`"GET"`, `"POST"`, etc.). |
| `httpRequestRoute` | The request path. |
| `setHeader(key, value)` | Set a response header. |
| `setCookie(name, options)` | Set a response cookie. |
| `logger` | `{ logInfo, logWarn, logError }` — structured logging. |
| `getConfig(key)` | Read from the project's App Config (secrets). |
| `httpClient` | Axios-backed HTTP client for outgoing requests. |
| `jwt` | `{ sign, verify, decode }` — JWT utilities. |
| `dayjs` | Day.js date library (UTC plugin pre-loaded). |
| `_` | Underscore.js utility library. |
| `zod` | Zod schema validation library. |

For the complete API reference with type signatures and examples, see the [Scripting Context](../scripting/context.md) page.
## Examples

### Basic Transformation

```javascript
// input = { "price": 100, "taxRate": 0.08 }
const total = input.price * (1 + input.taxRate);
return { total: total.toFixed(2) };
// output → { "total": "108.00" }
```

### Reading Request Data

```javascript
const userId = getRouteParam("id");       // from route /users/:id
const page = getQueryParam("page") || "1";
const authHeader = getHeader("Authorization");

logger.logInfo("Fetching user", { userId, page });
return { userId, page };
```

### Making an External HTTP Request

```javascript
const apiKey = getConfig("WEATHER_API_KEY");
const city = getQueryParam("city") || "London";

const response = await httpClient.get(
  `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${city}`
);
return response.data.current;
```

### JWT Verification

```javascript
const token = getHeader("Authorization").replace("Bearer ", "");
const { success, payload } = jwt.verify(token, getConfig("JWT_SECRET"));

if (!success) {
  return { error: "Invalid or expired token" };
}

// Store verified user for downstream blocks
verifiedUserId = payload.sub;
return { userId: payload.sub, role: payload.role };
```

### Using Underscore.js and Zod

```javascript
// Validate and transform incoming data
const bodySchema = zod.object({
  users: zod.array(zod.object({
    id: zod.number(),
    name: zod.string(),
    active: zod.boolean()
  }))
});

const parsed = bodySchema.safeParse(getRequestBody());
if (!parsed.success) {
  return { error: "Invalid input", details: parsed.error.flatten() };
}

const activeNames = _.chain(parsed.data.users)
  .filter(u => u.active)
  .pluck("name")
  .value();

return { activeUsers: activeNames };
```

### Sharing State with Subsequent Blocks

```javascript
// Variables assigned without `const/let/var` become workflow-level globals
processedAt = dayjs().utc().toISOString();
requestingUser = getRouteParam("userId");

return { status: "processing" };
// Next blocks can read: processedAt, requestingUser
```
## Error Handling

If your code throws an unhandled exception, the JS Runner returns:

```typescript
{
  successful: false,
  continueIfFail: false,
  error: error.toString(),
  next: <next_block_id>
}
```

This triggers the workflow's **Error Handler** block if one is configured. To handle errors gracefully within the script itself, use `try/catch`:

```javascript
try {
  const result = await httpClient.get("https://api.example.com/data");
  return result.data;
} catch (err) {
  logger.logError("External API call failed", err.message);
  return { error: "Service temporarily unavailable" };
}
```
## Runtime Constraints

| Constraint | Detail |
| :--- | :--- |
| **Timeout** | Keep computations and long `await` calls within the route execution limit. |
| **Imports** | Static ES `import` declarations are hoisted by the AST parser at compile time. `require()` is not supported. |
| **Async support** | `async/await` is fully supported. |
| **ES6+ syntax** | Arrow functions, destructuring, spread, template literals, etc. all work. |

See the [Scripting overview](../scripting/index.md) for the execution model, and [Imports & Libraries](../scripting/imports.md) for how to import modules and which libraries are available.
