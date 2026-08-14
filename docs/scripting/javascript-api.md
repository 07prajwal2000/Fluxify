---
title: JavaScript API Reference
description: Typed reference for the JavaScript APIs available in Fluxify workflows.
---

# JavaScript API Reference

This is the API exposed to JS Runner, Transformer, and `js:` expressions. Fluxify's DAG compiler emits scripts into the generated Bun route handler.

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
| `getRequestBody` | — | `any` | Parsed request body. |

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

## Configuration and state

```typescript
function getConfig(key: string): string | number | boolean | undefined;
```

`getConfig` returns a project App Config value for `key`, or `undefined` when it is not configured. Values assigned in scripts are available to later blocks in the same request only:

```javascript
currentUserId = input.id;
const secret = getConfig("JWT_SECRET");
```

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

| Method | Parameters | Returns |
| --- | --- | --- |
| `get<T>` | `url: string`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `post<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `put<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `delete<T>` | `url: string`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |
| `patch<T>` | `url: string`, `data?: any`, `headers?: HttpHeaders` | `Promise<AxiosResponse<T>>` |

## Logging and libraries

```typescript
const logger: {
  logInfo(value: any): void;
  logWarn(value: any): void;
  logError(value: any): void;
};

const libs: {
  dayjs: typeof import("dayjs");
  _: typeof import("underscore");
  zod: typeof import("zod");
};
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `logger.logInfo` | `value: any` | `void` | Writes an informational log entry. |
| `logger.logWarn` | `value: any` | `void` | Writes a warning log entry. |
| `logger.logError` | `value: any` | `void` | Writes an error log entry. |
| `libs.dayjs` | Day.js arguments | `Dayjs` | Bundled Day.js. |
| `libs._` | Underscore API arguments | varies | Bundled Underscore. |
| `libs.zod` | Zod API arguments | varies | Bundled Zod. |

## DB Native only

```typescript
function dbQuery(query: string): Promise<unknown>;
```

| API | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `dbQuery` | `query: string` | `Promise<unknown>` | Runs a SQL query. Available only in **DB Native** blocks. |

## Import rules

Static imports are discovered by the AST parser, deduplicated per route at load time, and reused across requests. Workers execute minified generated JavaScript, so avoid importing names that collide with context globals such as `input`, `jwt`, `logger`, or `httpClient`. See [Imports & Libraries](./imports.md).
