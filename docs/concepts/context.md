---
title: Execution Context
description: Understanding the shared environment that carries request data and helpers to every block in a workflow.
---

# Execution Context

The **Execution Context** is a per-request object created when an HTTP request triggers a workflow. It is passed to every block that runs and holds all the data and tools needed to process that request — from the incoming URL and headers to the scripting VM, logger, and global variables.

Think of it as the workflow's environment for a single request run.

---

## What the Context Contains

Every block in a workflow has access to:

- **Request data** — the incoming HTTP method, route, headers, cookies, query params, and body.
- **Global variable store** — a shared key-value space where blocks can read and write variables across the entire workflow run.
- **Scripting sandbox** — an isolated JavaScript VM where script blocks execute safely.
- **HTTP Client** — for making outbound HTTP requests.
- **Database access** — connections to configured database integrations.
- **Logger** — structured logging routed to console or a cloud observability provider.
- **App Config** — access to project-level secrets and settings.
- **JWT utilities** — helpers for signing, verifying, and decoding JSON Web Tokens.
- **Timeout control** — the context enforces a maximum execution time for the entire workflow.

For the complete scripting API (all available globals, functions, and examples), see the [Scripting Context](../scripting/context.md) reference.

---

## Global Variables

A key feature of the context is its **global variable store**. Any variable set in one block is immediately readable by all subsequent blocks in the same workflow run.

- **Set** in a script: `myVariable = "hello";`
- **Read** in any later block or `js:` expression: `myVariable`

Variables live only for the duration of a single request. They are not shared between different users or different requests.

---

## The `input` Variable

Every block receives the output of the **previous block** as `input`. This is separate from the global variable store — `input` only holds what the immediately preceding block returned.

```javascript
// Previous block returned { "user": { "name": "Alice" } }
return input.user.name; // → "Alice"
```

---

## Lifetime & Isolation

| Property | Behavior |
| :--- | :--- |
| **Scope** | One context per incoming HTTP request — never shared between requests. |
| **Isolation** | Concurrent requests each get their own context with no shared state. |
| **Timeout** | Workflows have a maximum execution time of **4 seconds**. Exceeding it returns a timeout error. |
| **Cleanup** | The context is discarded after the response is sent. |

---

## Related Pages

- [Scripting Context](../scripting/context.md) — Full API reference for all globals available in scripts.
- [Execution Engine](./execution-engine.md) — How blocks are run sequentially using the context.
- [JavaScript VM](./vm.md) — The sandboxed environment where scripts execute.
- [Logging](./logging.md) — How the logger routes to console or cloud providers.
- [App Config](./app-config.md) — Managing secrets and environment settings.
