---
title: Scripting Context
description: "Complete reference for all global variables, functions, and objects available inside JS Runner, Transformer, and js: expression fields."
---

# Scripting Context

Every time your JavaScript code runs — whether inside a **JS Runner** block, a **Transformer**, or any field using a `js:` expression — it executes within a secure, pre-configured environment called the **Scripting Context**.

This page is the complete reference for everything available in that environment.

> **How it works**: When the execution engine prepares to run a script, it takes the `vars` object from the [Execution Context](../concepts/context.md), injects all its properties as top-level globals into the V8 sandbox, and runs your code. This means every function listed below is callable directly by name, with no prefix.

---

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

---

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

> **Caution**: Variable names must not shadow built-in globals. Avoid names like `input`, `logger`, `jwt`, `libs`, `getHeader`, etc.

---

## HTTP Request Helpers

Read data from the incoming HTTP request that triggered this workflow. All functions return `""` (empty string) if the requested value is not present.

| Name | Signature | Description |
| :--- | :--- | :--- |
| `getQueryParam(key)` | `(key: string) => string` | Returns the value of a URL query parameter. |
| `getRouteParam(key)` | `(key: string) => string` | Returns the value of a dynamic path segment defined in the route (e.g., `:id`). |
| `getHeader(key)` | `(key: string) => string` | Returns a request header value. Header lookup is case-insensitive. |
| `getCookie(key)` | `(key: string) => string` | Returns a cookie value sent with the request. |
| `getRequestBody()` | `() => any` | Returns the parsed request body. Returns `null` for GET requests. Supports JSON, `application/x-www-form-urlencoded`, and plain text. |
| `httpRequestMethod` | `string` (constant) | The HTTP method of the request: `"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, etc. |
| `httpRequestRoute` | `string` (constant) | The full path of the incoming request, e.g., `"/api/orders/99"`. |

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

---

## HTTP Response Helpers

Shape the response that will be sent back to the caller when the workflow completes.

| Name | Signature | Description |
| :--- | :--- | :--- |
| `setHeader(key, value)` | `(key: string, value: string) => void` | Sets a custom HTTP header on the outgoing response. |
| `setCookie(name, options)` | `(name: string, options: CookieOptions) => void` | Sets a cookie on the outgoing response. |

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

---

## Logger

The `logger` object writes structured log entries to the configured output. The destination depends on project settings: **console** (default / local dev) or a **cloud observability provider** (Loki, OpenObserve, etc.). See [Logging](../concepts/logging.md).

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

---

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

---

## HTTP Client

`httpClient` is an Axios-backed client for making **outgoing** HTTP requests from within a script. It is distinct from the workflow-level **HTTP Request** block and is available for direct use in JS Runner code.

```typescript
httpClient.get<T>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.post<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.put<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.delete<T>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.patch<T>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>
httpClient.native(): AxiosInstance  // Full Axios instance for advanced usage
```

```javascript
// Fetch data from an external API inside a JS Runner
const authKey = getConfig("EXTERNAL_API_KEY");
const response = await httpClient.get("https://api.example.com/data", {
  "Authorization": `Bearer ${authKey}`
});
return response.data;
```

---

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

---

## Built-in Libraries (`libs`)

Three third-party libraries are bundled and available as top-level globals inside scripts. No import statement is needed.

### `dayjs` — Date & Time

Full [Day.js](https://day.js.org/) library with the `utc` plugin pre-loaded.

```javascript
const now = dayjs().utc().toISOString();
const formatted = dayjs("2026-01-15").format("MMMM D, YYYY"); // → "January 15, 2026"
const future = dayjs().add(7, "day").toDate();
```

### `_` — Underscore.js

Full [Underscore.js](https://underscorejs.org/) utility library for functional programming.

```javascript
const users = input.users;
const activeUsers = _.filter(users, u => u.active);
const names = _.pluck(activeUsers, "name");
const grouped = _.groupBy(users, "role");
```

### `zod` — Schema Validation

Full [Zod](https://zod.dev/) library for runtime schema validation and parsing.

```javascript
const schema = zod.object({
  name: zod.string().min(1),
  age: zod.number().positive()
});
const result = schema.safeParse(getRequestBody());
if (!result.success) {
  return { error: result.error.flatten() };
}
return result.data;
```

---

## Database Helper (DB Native Block Only)

`dbQuery` is **exclusively available** inside the **DB Native** block. It is injected into the VM context only when that specific block executes.

```typescript
dbQuery(query: string): Promise<unknown>
```

```javascript
// Only works inside a DB Native block:
const users = await dbQuery("SELECT id, name FROM users WHERE active = true");
return users;
```

Attempting to call `dbQuery` in a regular JS Runner block will result in a `ReferenceError`.

---

## Sandbox Constraints

The scripting environment is a secure **V8 sandbox** (via Node.js `vm` module). The following constraints apply:

| Constraint | Detail |
| :--- | :--- |
| **No Node.js globals** | `process`, `fs`, `require`, `__dirname`, etc. are not accessible. |
| **No arbitrary imports** | `require()` and ES `import` statements are not supported. |
| **Execution timeout** | Scripts are killed after **4 seconds**. Design scripts to be fast. |
| **No cross-request state** | Variables exist only for the duration of a single workflow run. |
| **Async supported** | `async/await` is fully supported. The VM waits for promise resolution. |
| **ES6+ syntax** | Modern JavaScript (arrow functions, destructuring, spread, etc.) is supported. |

---

## Quick Reference

```typescript
// ─── Block Input ───────────────────────────────────────────────
input                          // Output of the previous block

// ─── HTTP Request ──────────────────────────────────────────────
httpRequestMethod              // "GET" | "POST" | ...
httpRequestRoute               // "/api/path"
getQueryParam("key")           // URL ?key=value
getRouteParam("id")            // Route :id segment
getHeader("Authorization")     // Request header
getCookie("session")           // Request cookie
getRequestBody()               // Parsed request body (POST/PUT only)

// ─── HTTP Response ─────────────────────────────────────────────
setHeader("X-Custom", "val")
setCookie("name", { value, httpOnly, secure, ... })

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

// ─── Libraries ────────────────────────────────────────────────
dayjs()                        // Day.js (UTC extended)
_                              // Underscore.js
zod                            // Zod schema validation

// ─── DB Native block only ─────────────────────────────────────
dbQuery("SELECT ...")
```

---

## Technical Notes for LLMs and Developers

- **Injection mechanism**: All properties of the `ContextVarsType` object are spread as globals into the V8 `vm.createContext()` sandbox via `JsVM`. This is why helpers are available without a prefix.
- **`vars` is the canonical source**: Both built-in helpers and user-defined runtime variables live on the same `vars` object (`ContextVarsType & Record<string, any>`). User variables are simply additional keys added at runtime.
- **`input` is a separate injection**: The `input` variable is passed as a parameter to the VM `runAsync` call, not from `vars`. It changes with each block execution.
- **`dbQuery` is conditionally injected**: The DB Native block patches `vars.dbQuery` before running the VM, then removes it after — it is never a permanent global.
- **Libraries are server-side bundles**: `dayjs`, `_`, and `zod` are actual npm packages bundled in the server, not CDN links. They run in Node.js, not the browser.
