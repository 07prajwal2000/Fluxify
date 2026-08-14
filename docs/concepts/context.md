---
title: Execution Context
description: The request-scoped data and helpers available while a compiled Fluxify route runs.
---

# Execution Context

The **Execution Context** is everything a route needs while handling one HTTP request: its request data, the output flowing between blocks, response controls, configuration, and the helpers available to JavaScript.

It is created for the request and discarded when that request finishes. Nothing in an execution context is shared with another request.

## How it fits into a compiled route

Fluxify compiles a route's blocks and edges into a native JavaScript handler when the route is saved. When a matching request arrives, Bun runs that handler directly. The execution context supplies the request-specific values and helpers used by the handler.

```mermaid
flowchart LR
  request["Incoming HTTP request"] --> context["Fresh execution context"]
  context --> handler["Compiled route handler"]
  handler --> response["HTTP response"]
```

This is not a visual workflow interpreter or a VM that traverses the canvas at request time. The canvas describes the route; the compiled handler performs the work.

## What is available

The context makes these categories of data available to blocks and scripts:

| Category | What it provides |
| --- | --- |
| **Request data** | Method, route parameters, query parameters, headers, cookies, and parsed request body. |
| **Flowing data** | `input`, the output of the block immediately before the current block. |
| **Runtime variables** | Values you set during this request and reuse in later blocks. |
| **Response controls** | Helpers to set response headers and cookies before returning a result. |
| **App Config** | Read-only project settings and secrets through `getConfig()`. |
| **Service helpers** | Logging, outbound HTTP, JWT utilities, built-in libraries, and block-specific database access. |

For signatures, parameter types, return types, and examples, use the [JavaScript API Reference](../scripting/javascript-api.md).

## Data flowing through a route

Each block has one input and one output. The output from a completed block becomes `input` for the next block on the active path.

```javascript
// If the previous block returned { user: { name: "Avery" } }
return input.user.name;
```

`input` is deliberately local to the current step. Use it for data moving between adjacent blocks.

### Runtime variables

When several later steps need the same value, store it as a runtime variable in a script or with a **Set Variable** block:

```javascript
currentUser = { id: input.id, name: input.name };
```

The value is available to subsequent blocks in that same request:

```javascript
return currentUser.name;
```

Runtime variables are useful for request-local state, not storage. They disappear after the response is produced and are never visible to another user's request.

> **Tip:** Choose clear, specific variable names. Do not reuse the names of built-in helpers such as `input`, `logger`, `jwt`, or `getConfig`.

## Request and response boundaries

The context begins with the HTTP request and ends with the response. Scripts can read request values with helpers such as `getRouteParam("id")` and `getRequestBody()`, then shape the outgoing response with `setHeader()` or `setCookie()`.

App Config is read-only at runtime. It is the right place for stable configuration and secrets; runtime variables are the right place for temporary values produced while processing a request. See [App Config](./app-config.md) for managing configuration safely.

## Isolation and limits

| Property | Behavior |
| --- | --- |
| **Scope** | One execution context per HTTP request. |
| **Isolation** | Concurrent requests have separate data and variables. |
| **Lifetime** | Created when the route begins and discarded after its response or failure. |
| **Runtime** | The compiled handler runs in Bun's JavaScript runtime, powered by Apple's JavaScriptCore engine. |
| **Timeouts** | Optional experimental worker timeouts can enforce a 30-second route limit, or a route-specific limit, when enabled in project settings. |

Bun APIs are available in scripts where appropriate. This is a Bun runtime, not Node.js; [Bun's runtime API documentation](https://bun.com/docs/runtime/bun-apis) is a useful companion reference.

The worker supervisor is designed to protect the service from badly behaved workloads. Its CPU and network protections are still being completed, so treat them as evolving safeguards and keep your own database and external-service calls bounded.

## Related pages

- [JavaScript API Reference](../scripting/javascript-api.md) — Complete script globals, helpers, types, and examples.
- [Scripting overview](../scripting/index.md) — How JavaScript is compiled into a route.
- [Blocks](./blocks.md) — The work units that make up a route.
- [Edges](./edges.md) — How data moves between blocks.
- [App Config](./app-config.md) — Project-level configuration and secrets.
