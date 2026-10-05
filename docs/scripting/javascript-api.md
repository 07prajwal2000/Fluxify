---
title: JavaScript API Reference
description: Typed reference for the JavaScript APIs available in Fluxify workflows.
---

# JavaScript API Reference

This is the API exposed to JS Runner, Transformer, and `js:` expressions. Fluxify's DAG compiler emits scripts into the generated Bun route handler.

Every script runs inside an `async` function: `await` works anywhere, and `return` sends a value to the next block. Only `jwt` is built in as a library. Install anything else under **Project Settings > npm Packages** and `import` it.

## Where each API is available

| API | Route | Workflow | Custom block | Only in |
| --- | --- | --- | --- | --- |
| `input`, `outputs`, `trigger`, `logger`, `jwt`, `httpClient`, `getConfig`, `ValidationError` | Yes | Yes | Yes | |
| `getRequestBody()` | Request body | Run payload | Caller's | |
| `getQueryParam`, `getRouteParam`, `getHeader`, `getCookie`, `httpRequestMethod`, `httpRequestRoute` | Request values | Empty | Caller's | |
| `setHeader`, `setCookie` | Yes | No effect | Caller's | |
| `getResponseBody()`, `getResponseStatus()` | `null` | `null` | `null` | After middlewares |
| `params` | No | No | Yes | Custom blocks |
| `dbQuery` | No | No | No | DB Native block (PostgreSQL, MySQL) |
| `db`, `ObjectId` | No | No | No | DB Native block (MongoDB) |
| `kv` | No | No | No | KV Raw Connection block |
| `testsuite` | No | No | No | Test-only custom blocks |

"Caller's" means the route or workflow that uses the block. More in [Where Your Code Runs](./environments.md).

::: info Scripts in an after middleware
In a block that runs [after the route](../concepts/middlewares.md#what-each-step-receives), the first `input` is the route's reply, `{ httpCode, body }`, not the body itself. Work on `input.body`, or read the reply with [`getResponseBody()` and `getResponseStatus()`](#response-values), which keep it even after `input` has been reshaped.
:::

## Request values

```typescript
const input: any;
const httpRequestMethod: string;
const httpRequestRoute: string;

function getQueryParam(key: string): string;
function getRouteParam(key: string): string;
function getHeader(key: string): string;
function getCookie(key: string): string;
function getRequestBody(): any;
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `input` | — | `any` | Output from the preceding block. |
| `httpRequestMethod` | — | `string` | Incoming method, for example `"GET"`. |
| `httpRequestRoute` | — | `string` | Incoming request path. |
| `getQueryParam` | `key: string` | `string` | Query parameter, or `""` if absent. |
| `getRouteParam` | `key: string` | `string` | Named route parameter, or `""` if absent. |
| `getHeader` | `key: string` | `string` | Case-insensitive request header, or `""` if absent. |
| `getCookie` | `key: string` | `string` | Request cookie, or `""` if absent. |
| `getRequestBody` | — | `any` | Parsed request body, or `null` when there is none. In a workflow, the payload the run was given. |

```javascript
const id = getRouteParam("id");
const page = Number(getQueryParam("page") || 1);
return { id, page, body: getRequestBody() };
```

## Response helpers

```typescript
type CookieSameSite = "Strict" | "Lax" | "None";

interface CookieOptions {
  value: string | number;
  domain?: string;
  path?: string;
  expiry?: string | Date;
  httpOnly?: boolean;
  secure?: boolean;
  samesite?: CookieSameSite;
}

function setHeader(key: string, value: string): void;
function setCookie(name: string, options: CookieOptions): void;
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `setHeader` | `key: string`, `value: string` | `void` | Adds an outgoing response header. |
| `setCookie` | `name: string`, `options: CookieOptions` | `void` | Adds an outgoing cookie. `samesite` defaults to `"Strict"`. |

## Response values

Only useful in an [after middleware](../concepts/middlewares.md), where a reply already exists. Everywhere else both return `null`.

```typescript
function getResponseBody(): any;
function getResponseStatus(): number | null;
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `getResponseBody` | — | `any` | The body of the reply the after middlewares started from: the route's, or a before middleware's if one answered. |
| `getResponseStatus` | — | `number \| null` | That reply's status code. |

Both stay the same for the whole after chain, so they still work after an earlier block replaced `input`:

```javascript
// an earlier step returned something else; the reply is not lost
if (getResponseStatus() >= 400) return getResponseBody();
return { data: getResponseBody(), servedAt: new Date().toISOString() };
```

## Configuration and state

```typescript
function getConfig(key: string): string | number | boolean | undefined;
```

`getConfig` returns a project App Config value for `key`, or `undefined` when it is not configured. Values assigned in scripts are available to later blocks in the same request only:

```javascript
currentUserId = input.id;
const secret = getConfig("JWT_SECRET");
```

### Saved block outputs

```typescript
const outputs: Record<string, any>;
```

When a block has **Save output to variable** turned on, its output is stored in `outputs` under the name you chose. Any later block in the same request can read it. `outputs` starts empty on every request, so values never carry over to the next one.

```javascript
// "Fetch Users" block saves its output as "users"
return outputs.users.filter((user) => user.active);
```

`outputs` is created when the first block saves something. If a block might run before any save, read it as `outputs?.users`.

## Trigger

```typescript
interface TriggerEvent {
  data: any;
  meta: { id?: string; receivedAt?: string; source?: string; [key: string]: any };
}

const trigger: {
  kind: "route" | "job" | "workflow" | "cron" | "trigger";
  source: string;
  reply: "sync" | "async";
  id?: string;
  data: TriggerEvent[];
  meta: { batchId: string; size: number; firstReceivedAt?: string; lastReceivedAt?: string; attempt?: number };
  connection?: {
    raw: any;
    commit(): Promise<void>;
    moveToDLQ(error?: any): Promise<void>;
    lag(): Promise<number | null>;
  };
};
```

| API | Returns | Description |
| --- | --- | --- |
| `trigger.kind` | `string` | `"route"` for an HTTP request, `"trigger"` for a workflow run, `"job"` for a queued custom block. `"workflow"` and `"cron"` are reserved. |
| `trigger.source` | `string` | Where the work came from: `"http"`, `"internal"`, `"schedule"`, `"kafka"`, `"nats"` and so on. |
| `trigger.reply` | `"sync" \| "async"` | Whether the caller waits for the answer. |
| `trigger.id` | `string \| undefined` | Correlation id, when there is one. |
| `trigger.data` | `TriggerEvent[]` | The events of the run. Always a list, even for one event. Workflows only. |
| `trigger.meta` | object | Batch details. `size` is how many events. Workflows only. |
| `trigger.connection` | object \| `undefined` | Queue triggers only (Kafka, NATS, SQS, Redis Streams, RabbitMQ). `commit()` marks the batch done, `moveToDLQ()` parks it, `lag()` counts what is waiting, and `raw` is the underlying client. Use `raw` with care; see [Using the client directly](../concepts/triggers.md#using-the-client-directly). |

```javascript
if (trigger.source === "schedule") {
  logger.logInfo("Nightly run");
}
return trigger.data.map((event) => event.data);
```

See [Triggers](../concepts/triggers.md#what-a-workflow-receives) for batching, and `input` for the one-event shortcut.

## Custom block parameters

```typescript
const params: Record<string, any>; // the settings filled in where the block is used
```

`params` exists only inside a [custom block](../blocks/custom-blocks.md). Each setting is a key, for example `params.webhook_url`. An App Config selector holds the key name, so read the value with `getConfig(params.key_name)`.

## Errors

```typescript
class ValidationError extends Error {
  constructor(payload: any);
}
```

Throw `ValidationError` from a **Use JavaScript** request validator to fail validation with your own payload, returned to the caller in `errors[].errors`. See [Routing](../getting-started/routing.md).

## JWT

`jwt` is available globally and uses `jsonwebtoken` under the hood.

```typescript
const jwt: {
  sign(payload: object, secretKey: string, options?: object): string;
  verify(token: string, secretKey: string, options?: object): {
    success: boolean;
    payload: Record<string, string> | null;
  };
  decode(token: string, options?: object): Record<string, string> | null;
};
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `jwt.sign` | `payload: object`, `secretKey: string`, `options?: object` | `string` | Signs and returns a JWT. Options follow `jsonwebtoken` sign options. |
| `jwt.verify` | `token: string`, `secretKey: string`, `options?: object` | `{ success: boolean; payload: Record<string, string> \| null }` | Verifies a token; invalid tokens return `success: false` rather than throwing. |
| `jwt.decode` | `token: string`, `options?: object` | `Record<string, string> \| null` | Decodes a token without signature verification. |

## HTTP client

```typescript
type HttpHeaders = Record<string, string>;
interface AxiosResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: any;
  config: any;
}

const httpClient: {
  get<T = any>(url: string, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  post<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  put<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  delete<T = any>(url: string, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  patch<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
};
```

The promise rejects on a non-2xx answer or a network error. Pass a full URL.

| Method | Parameters | Returns |
| --- | --- | --- |
| `get<T>` | `url: string`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `post<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `put<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `delete<T>` | `url: string`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `patch<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |

## Logging

```typescript
const logger: {
  logInfo(value: any): void;
  logWarn(value: any): void;
  logError(value: any): void;
};
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `logger.logInfo` | `value: any` | `void` | Writes an informational log entry. |
| `logger.logWarn` | `value: any` | `void` | Writes a warning log entry. |
| `logger.logError` | `value: any` | `void` | Writes an error log entry. |

## DB Native only

```typescript
function dbQuery(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>; // PostgreSQL, MySQL
const db: Db;             // MongoDB: the driver's database
const ObjectId: ObjectId; // MongoDB: builds ids
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `dbQuery` | `query: string`, `params?: unknown[]` | `Promise<rows[]>` | Runs a SQL query and returns the rows. Put values in `params` and use `$1`, `$2` placeholders (MySQL also takes `?`). PostgreSQL and MySQL only. On MongoDB, a query throws and `dbQuery()` with nothing returns `db`. |
| `db` | none | `Db` | MongoDB only: the database, from the official MongoDB driver. Inside a transaction, every collection call joins it. |
| `ObjectId` | `id?: string` | `ObjectId` | MongoDB only: `new ObjectId(id)` turns a string into an id you can query `_id` with. |

## KV Raw Connection only

```typescript
const kv: any; // ioredis client for Redis, the memcached client for Memcached
```

`kv` is the raw client of the selected connection, so use that client's own methods, for example `await kv.incr("hits")`. Available only in **KV Raw Connection** blocks. See [KV Raw Connection](../blocks/kv-raw.md).

## Test-only custom blocks

```typescript
const testsuite: {
  phase: "setup" | "teardown";
  runId: string;
  suite: { id: string; name: string };
  setup?: any;    // teardown only: what setup returned
  outcome?: "passed" | "failed" | "error" | "timeout"; // teardown only
};
```

`testsuite` exists only in a custom block whose **Used for** is **Test setup & teardown**. See [Setup and Teardown](../testing/setup-and-teardown.md). Test hooks and checks use `t` and `fluxify` instead, see [Hooks](../testing/hooks.md).

## Import rules

Static imports are discovered by the AST parser, deduplicated per route at load time, and reused across requests. Workers execute minified generated JavaScript, so avoid importing names that collide with context globals such as `input`, `jwt`, `logger`, or `httpClient`. See [Imports & Libraries](./imports.md).
