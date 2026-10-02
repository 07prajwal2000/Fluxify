---
title: Scripting Context
description: "Complete reference for all global variables, functions, and objects available inside JS Runner, Transformer, and js: expression fields."
---

# Scripting Context

Every time your JavaScript code runs — whether inside a **JS Runner** block, a **Transformer**, or any field using a `js:` expression — it executes within a secure, pre-configured environment called the **Scripting Context**.

This page is the complete reference for everything available in that environment. To see which names exist in which place (route, workflow, custom block, DB Native and so on), read [Where Your Code Runs](./environments.md).

> **Always async**: Your code runs inside an `async` function, so `await` works anywhere in it with no setup. Write `const res = await httpClient.get(url);` and carry on. You still need `return` to send a value to the next block.

> **How it works**: The DAG compiler emits script code into the route handler and wires in the [Execution Context](../concepts/context.md). The helpers below are available directly in the generated handler, with no prefix and no VM layer.
## The `input` Variable

The single most important variable in any script:

| Variable | Description |
| :--- | :--- |
| `input` | The output of the **immediately preceding block** in the workflow. |

In a **JS Runner** or **Transformer**, `input` holds whatever the previous block returned. In a conditional `js:` expression, `input` is the value being evaluated at that field.

```javascript
// If the previous HTTP Request block returned { "user": { "name": "Alice" } }
return input.user.name; // → "Alice"
```

> `input` is populated per-execution by the engine, not from `vars`. It is not persistent — each block receives only the output of its direct predecessor.
## Global Variables (Runtime State)

Beyond built-in helpers, `vars` functions as a mutable key-value store for the duration of the workflow run. Any variable you assign in a script becomes a global accessible by all subsequent blocks.

**Writing a global variable:**
```javascript
// In a JS Runner block:
currentUser = { id: 1, name: "Alice" };
orderCount = 0;
```

**Reading a global variable (in any later block):**
```javascript
// In a subsequent JS Runner or js: expression:
return currentUser.name; // → "Alice"
```

You can also use **Set Variable** blocks to write globals without writing code.

### Saved Block Outputs

Blocks that produce data (HTTP Request, Transformer, Array Operations, database blocks and custom blocks) have a **Save output to variable** option. Turn it on and give it a name, and the block's output is stored under `outputs`:

```javascript
// "Fetch Users" saved its output as "users"
return outputs.users.length;
```

`outputs` is fresh for every request. A value saved in one request is never seen by another. It is created when the first block saves something, so a block that may run before any save should read `outputs?.users`.

> **Caution**: Variable names must not shadow built-in globals. Avoid names like `input`, `outputs`, `trigger`, `params`, `logger`, `jwt`, `getHeader`, etc.
## HTTP Request Helpers

Read data from the incoming HTTP request that triggered this workflow. All functions return `""` (empty string) if the requested value is not present.

| Name | Signature | Description |
| :--- | :--- | :--- |
| `getQueryParam(key)` | `(key: string) => string` | Returns the value of a URL query parameter. |
| `getRouteParam(key)` | `(key: string) => string` | Returns the value of a dynamic path segment defined in the route (e.g., `:id`). |
| `getHeader(key)` | `(key: string) => string` | Returns a request header value. Header lookup is case-insensitive. |
| `getCookie(key)` | `(key: string) => string` | Returns a cookie value sent with the request. |
| `getRequestBody()` | `() => any` | Returns the parsed request body, or `null` when the request has none. JSON becomes a value, form data becomes an object (uploaded files included), a raw binary body a file-like value. See [accepted content types](../getting-started/routing.md#accepted-content-types). |
| `httpRequestMethod` | `string` (constant) | The HTTP method of the request: `"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, etc. |
| `httpRequestRoute` | `string` (constant) | The full path of the incoming request, e.g., `"/api/orders/99"`. |

These describe an HTTP request, so in a **workflow** there is none: the `get...` helpers return `""`, `httpRequestMethod` is `""`, and `getRequestBody()` returns the payload the run was given. See [Routes and workflows](./environments.md#routes-and-workflows).

**Examples:**
```javascript
// Route: /products/:category?page=2
const category = getRouteParam("category");  // e.g., "electronics"
const page = getQueryParam("page");           // "2"
const authHeader = getHeader("Authorization"); // "Bearer eyJ..."

// POST request with JSON body { "amount": 50 }
const body = getRequestBody();
return body.amount * 1.1; // → 55
```
## HTTP Response Helpers

Shape the response that will be sent back to the caller when the route completes. In a workflow, or a route running in the background, there is no response and these do nothing.

| Name | Signature | Description |
| :--- | :--- | :--- |
| `setHeader(key, value)` | `(key: string, value: string) => void` | Sets a custom HTTP header on the outgoing response. |
| `setCookie(name, options)` | `(name: string, options: CookieOptions) => void` | Sets a cookie on the outgoing response. |
| `getResponseBody()` | `() => any` | In an [after middleware](../concepts/middlewares.md): the body of the reply the after chain started from, even once `input` has been reshaped. `null` anywhere else. |
| `getResponseStatus()` | `() => number \| null` | In an after middleware: that reply's status code. `null` anywhere else. |

#### `setCookie` Options

```typescript
{
  value: string | number;     // The cookie value (required)
  domain?: string;            // Cookie domain
  path?: string;              // Cookie path
  expiry?: string;            // Expiry date (e.g., "2026-01-01T00:00:00Z")
  httpOnly?: boolean;         // Restrict to HTTP(S) only (prevents JS access)
  secure?: boolean;           // HTTPS-only
  samesite?: "Strict" | "Lax" | "None"; // Default: "Strict"
}
```

**Examples:**
```javascript
// Set a response header
setHeader("X-Request-Id", "abc-123");

// Set a session cookie
setCookie("session_token", {
  value: "tok_xyz789",
  httpOnly: true,
  secure: true,
  expiry: "2026-12-31T23:59:59Z",
  samesite: "Strict"
});
```
## Logger

The `logger` object writes structured log entries to the configured output. The destination depends on project settings: **console** (default / local dev) or a configured observability destination. See [Telemetry Configuration](../concepts/telemetry-configuration.md).

| Method | Description |
| :--- | :--- |
| `logger.logInfo(...args)` | Informational message. Use for normal operational events. |
| `logger.logWarn(...args)` | Warning message. Use for recoverable or unexpected conditions. |
| `logger.logError(...args)` | Error message. Use for failures that need investigation. |

```javascript
logger.logInfo("Order processing started", { orderId: input.id });

const result = processOrder(input);
if (!result.success) {
  logger.logError("Order failed", result.error);
}
```
## App Config

`getConfig(key)` reads values from the project's **App Config** — a secure store for secrets, API keys, and environment-specific settings.

```typescript
getConfig(key: string): string | number | boolean
```

```javascript
const stripeKey = getConfig("STRIPE_SECRET_KEY");
const maxRetries = getConfig("MAX_RETRY_COUNT"); // may return a number
```

> Never hardcode secrets in scripts. Always use `getConfig()`.
## HTTP Client

`httpClient` is an Axios-backed client for making **outgoing** HTTP requests from within a script. It is distinct from the workflow-level **HTTP Request** block and is available for direct use in JS Runner code.

```typescript
httpClient.get<T>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.post<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.put<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.delete<T>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.patch<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
```

The promise rejects when the server answers with a non-2xx status or the call fails, so wrap it in `try` and `catch` if you want to handle that yourself. Always pass a full URL.

```javascript
// Fetch data from an external API inside a JS Runner
const authKey = getConfig("EXTERNAL_API_KEY");
const response = await httpClient.get("https://api.example.com/data", {
  "Authorization": `Bearer ${authKey}`
});
return response.data;
```
## JWT Utilities

A built-in JWT helper is available globally as `jwt`:

| Method | Returns | Description |
| :--- | :--- | :--- |
| `jwt.sign(payload, secretKey, options?)` | `string` | Signs a payload and returns a JWT token. |
| `jwt.verify(token, secretKey, options?)` | `{ success: boolean, payload: Record<string, string> \| null }` | Verifies a token. On failure, returns `{ success: false, payload: null }`. Does not throw. |
| `jwt.decode(token, options?)` | `Record<string, string> \| null` | Decodes a token without verifying the signature. |

```javascript
// Sign a token
const token = jwt.sign({ userId: 42, role: "admin" }, getConfig("JWT_SECRET"), {
  expiresIn: "1h"
});

// Verify a token from the Authorization header
const rawToken = getHeader("Authorization").replace("Bearer ", "");
const { success, payload } = jwt.verify(rawToken, getConfig("JWT_SECRET"));
if (!success) {
  return { error: "Unauthorized" };
}
return payload.userId;
```
## Using npm Packages

There is no built-in library object. Install the packages you need in **Project Settings > npm Packages**, then `import` them in any script. The `jwt` helper stays available globally. See [Imports & Libraries](./imports.md) for details.

```javascript
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  age: z.number().positive()
});
const result = schema.safeParse(getRequestBody());
if (!result.success) {
  return { error: result.error.flatten() };
}
return result.data;
```
## Database Helper (DB Native Block Only)

`dbQuery` is **exclusively available** inside the **DB Native** block. The compiler only emits this helper for that block.

```typescript
dbQuery(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
```

It returns the result rows as an array. Pass values through `params` with `$1` (PostgreSQL) or `?` (MySQL) placeholders, never by building the query string yourself.

```javascript
// Only works inside a DB Native block:
const users = await dbQuery("SELECT id, name FROM users WHERE active = $1", [true]);
return users;
```

Outside a DB Native block, `dbQuery` is not defined, and calling it fails.
## Trigger

`trigger` tells you what started the run. It is available everywhere, and it is most useful in workflows, where it holds the events a trigger collected.

```javascript
// Route: trigger.source === "http", trigger.data is not set
// Workflow started by a Kafka trigger: trigger.source === "kafka"
const events = trigger.data;           // always a list, even for one event
logger.logInfo("Batch", { size: trigger.meta.size, source: trigger.source });
return events.map((event) => event.data);
```

| Field | What it is |
| :--- | :--- |
| `trigger.kind` | `"route"` for an HTTP request, `"trigger"` for a workflow run, `"job"` for a queued custom block. |
| `trigger.source` | Where the work came from: `"http"`, `"internal"` (Trigger Workflow block or **Run** button), `"schedule"`, or a queue such as `"kafka"` or `"nats"`. |
| `trigger.reply` | `"sync"` when the caller waits for the answer, `"async"` for fire-and-forget. |
| `trigger.id` | A correlation id, when there is one. |
| `trigger.data` | The events, each as `{ data, meta: { id?, receivedAt?, source? } }`. Workflows only. |
| `trigger.meta` | `{ batchId, size, firstReceivedAt?, lastReceivedAt?, attempt? }`. Workflows only. |
| `trigger.connection` | Queue triggers only (Kafka, NATS, SQS, Redis Streams, RabbitMQ): `commit()`, `moveToDLQ(error?)`, `lag()`, and `raw`, the underlying client. |

When exactly one event arrived, `input` is that event's payload, which is shorter than `trigger.data[0].data`. See [Triggers](../concepts/triggers.md) for batching and the queue controls.

## Custom Block Parameters

Inside a [custom block](../blocks/custom-blocks.md), `params` holds the settings filled in where the block is used:

```javascript
const url = params.webhook_url;
const key = getConfig(params.api_key_name); // an App Config selector holds the key name
```

`params` is not defined in routes and workflows.

## Raw Key-Value Client (KV Raw Block Only)

`kv` is the raw Redis or Memcached client, and is available only inside the **KV Raw Connection** block. See [KV Raw Connection](../blocks/kv-raw.md).

```javascript
return await kv.incr("hits");
```

## Validation Errors

`ValidationError` is available in every script. It is meant for **Use JavaScript** request validators: throw it to fail validation with your own message. Whatever you pass is returned to the caller in `errors[].errors`. See [Routing](../getting-started/routing.md).

```javascript
if (input.length < 8) {
  throw new ValidationError({ message: "Password needs 8 or more characters" });
}
return true;
```
## Runtime Constraints

Scripts execute as part of the compiled route handler in Bun. The following constraints apply:

| Constraint | Detail |
| :--- | :--- |
| **Always async** | Your code runs inside an `async` function. `await` works anywhere in it, and you still need `return` to send a value on. |
| **Libraries** | None are built in except `jwt`. Install packages in **Project Settings > npm Packages**, then `import` them. See [Imports & Libraries](./imports.md). |
| **Imports** | ES `import` statements work for built-in modules and your installed packages. `require()` is not supported. |
| **Globals** | The standard JavaScript and Bun globals work, such as `Math`, `JSON`, `Date`, `fetch`, `URL` and `crypto`. |
| **Time limit** | There is no separate limit for one script. The route or workflow timeout covers the whole run. See [Where Your Code Runs](./environments.md#time-limits). |
| **No cross-request state** | Variables exist only for the duration of a single run. |
| **ES6+ syntax** | Modern JavaScript (arrow functions, destructuring, spread, etc.) is supported. |
## Quick Reference

```typescript
// ─── Block Input ───────────────────────────────────────────────
input                          // Output of the previous block
outputs.name                   // Saved with "Save output to variable"
trigger.source                 // What started the run ("http", "schedule", "kafka"...)
trigger.data                   // Workflow events, always a list
params.name                    // Custom blocks only: the block's settings

// ─── HTTP Request ──────────────────────────────────────────────
httpRequestMethod              // "GET" | "POST" | ...
httpRequestRoute               // "/api/path"
getQueryParam("key")           // URL ?key=value
getRouteParam("id")            // Route :id segment
getHeader("Authorization")     // Request header
getCookie("session")           // Request cookie
getRequestBody()               // Parsed request body (a workflow: its payload)

// ─── HTTP Response ─────────────────────────────────────────────
setHeader("X-Custom", "val")
setCookie("name", { value, httpOnly, secure, ... })
getResponseBody()              // After middlewares: the reply's body (else null)
getResponseStatus()            // After middlewares: the reply's status code (else null)

// ─── Utilities ────────────────────────────────────────────────
logger.logInfo(...)
logger.logWarn(...)
logger.logError(...)
getConfig("SECRET_KEY")
httpClient.get(url, headers?)
httpClient.post(url, data?, headers?)

// ─── JWT ──────────────────────────────────────────────────────
jwt.sign(payload, secret, options?)
jwt.verify(token, secret, options?)
jwt.decode(token, options?)

// ─── Errors ───────────────────────────────────────────────────
throw new ValidationError({ message: "..." }) // request validators

// ─── npm packages ─────────────────────────────────────────────
import { z } from "zod";       // any package installed in the project

// ─── Always async ─────────────────────────────────────────────
await httpClient.get(url)      // await works anywhere

// ─── DB Native block only ─────────────────────────────────────
dbQuery("SELECT ...")

// ─── KV Raw Connection block only ─────────────────────────────
kv.get("key")
```
## Technical Notes for LLMs and Developers

- **Compilation mechanism**: The compiler emits the script alongside the route handler and provides context helpers directly to that generated code.
- **`vars` is the canonical source**: Both built-in helpers and user-defined runtime variables live on the same `vars` object (`ContextVarsType & Record<string, any>`). User variables are simply additional keys added at runtime.
- **`input` is per block**: The compiler carries each block's result forward as `input`; it changes with each block execution.
- **Scripts are async functions**: each script is wrapped as `async function (input, params)`, so `await` is always valid and the result is whatever it returns.
- **`dbQuery` and `kv` are block-scoped**: they exist only while a DB Native or KV Raw Connection block runs its code.
- **`params` is per invocation**: a custom block reads it from its own call, so nested and concurrent calls never clash.
- **Global lookup**: a bare name is read from the run's `vars` first, then from the standard JavaScript and Bun globals.
- **Packages run on the server**: packages you install are imported by your scripts on the server, not in the browser.
- **Imports are hoisted**: `import` statements are lifted out of your script and loaded once when the workflow is saved, not on each request.
