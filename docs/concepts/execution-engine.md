---
title: Execution Engine
description: The core system that runs your workflows block by block, manages the execution context, handles errors, and enforces timeouts.
---

# Execution Engine

The **Execution Engine** is the runtime core of Fluxify. Every time an HTTP request is matched to a workflow, the engine takes over — it walks the block graph, passes data between steps, manages failures, and enforces time limits.

---

## How the Engine Runs a Workflow

When a request arrives, the server assembles an [Execution Context](./context.md) and then calls the engine's `start()` method with the ID of the first block to run (the **Entrypoint**).

```
Incoming Request
      │
      ▼
 Context Created (vars, VM, DB, timeout)
      │
      ▼
 Engine.start(entrypointBlockId)
      │
      ├─► Block A executes → output passed as `input` to Block B
      │
      ├─► Block B executes → output passed as `input` to Block C
      │
      ├─► Block C fails → Error Handler redirects to Block D
      │
      └─► Block D (Response) executes → engine stops, result returned
```

### Step-by-Step

1. **Entrypoint**: The engine starts at a designated block (typically the **Entrypoint** block tied to the route).
2. **Block execution**: Each block's `executeAsync()` method is called with the previous block's output as `params` (accessible as `input` in scripts).
3. **Navigation**: If a block returns a `next` field, the engine loads that block and continues. If `next` is absent, execution stops.
4. **Error handling**: If a block fails and does not set `continueIfFail: true`, the engine routes to the configured **Error Handler** block. If the error handler has no continuation, execution stops.
5. **Timeout enforcement**: Before each iteration, the engine checks if `performance.now()` has exceeded `stopper.timeoutEnd`. If so, execution stops and a timeout error is returned.
6. **Final result**: The last `BlockOutput` is returned to the request router, which serializes it into an HTTP response.

---

## The Context & The Engine

The `Engine` receives the [Execution Context](./context.md) in its `EngineOptions`. It does not read request data directly — all request awareness comes from the context:

```typescript
export type EngineOptions = {
  errorHandlerId: string;          // ID of the fallback Error Handler block
  maxExecutionTimeInMs?: number;   // Optional override for timeout
  context: Context;                // The full execution context
};
```

The engine only directly uses `context.stopper` to track timeouts. Every block receives the full context via its constructor, giving it access to the VM, helpers, logger, DB, and HTTP client.

---

## Timeout System

Workflows are subject to a **4-second execution timeout** by default (controlled by `RESPONSE_TIMEOUT = 4000` ms).

| Phase | Behavior |
| :--- | :--- |
| **First block starts** | `stopper.timeoutEnd` is set to `performance.now() + stopper.duration`. |
| **Each iteration** | The engine checks `performance.now() >= stopper.timeoutEnd`. |
| **Timeout detected** | Execution halts immediately. Returns `{ successful: false, error: "Execution timeout exceeded" }`. |
| **Post-loop buffer** | After the loop, 20ms is added to `timeoutEnd` to allow the final check to occur without false positives. |
| **`ExecutionTimeoutError`** | Blocks can also throw this error explicitly; the engine catches it and terminates cleanly. |

> **Tip**: Long-running tasks (like DB queries or external HTTP calls) count toward the timeout. Design workflows to be efficient and avoid unnecessary sequential round-trips.

---

## Error Handling

Every workflow must have an **Error Handler** block configured. The engine uses its ID (`errorHandlerId`) to route failures.

**Failure flow:**
1. Block throws an exception or returns `successful: false` with `continueIfFail: false`.
2. Engine calls `errorBlock.executeAsync(error)`.
3. If the error block returns a `next` block ID, execution resumes from there.
4. If the error block has no `next`, the last failure result is returned.

**`continueIfFail` flag**: A block can signal that even on failure the engine should proceed to `next`. This is used by blocks like **JS Runner** (which always sets `continueIfFail: true` on success).

---

## Block Output Contract

Every block must return a `BlockOutput` object:

```typescript
interface BlockOutput {
  output?: any;           // The data to pass to the next block as `input`
  next?: string;          // ID of the next block to run (undefined = stop)
  error?: string;         // Error message (set on failure)
  successful: boolean;    // Whether this block succeeded
  continueIfFail: boolean; // If true, engine moves to `next` even on failure
}
```

---

## Relationship to the Context

The engine is intentionally thin — it knows nothing about HTTP, databases, or scripting. All of that lives in the **Context** that surrounds it:

| Concern | Handled by |
| :--- | :--- |
| Request parsing | `handleRequest()` in the request router |
| Variable state | `vars` in the Context |
| Script execution | `context.vm` (JsVM sandbox) |
| DB access | `context.dbFactory` |
| Outgoing HTTP | `context.httpClient` |
| Logging | `context.vars.logger` |
| Timeout | `context.stopper` (read by Engine) |

See [Execution Context](./context.md) for the full context reference.

---

## Performance

The engine is designed to be lightweight:
- **No I/O in the loop**: The engine itself does zero I/O. All I/O happens inside blocks.
- **Concurrent requests**: Because each request gets its own isolated context and engine instance, many requests can run in parallel without interference.
- **Single-threaded execution per workflow**: Blocks within one workflow run sequentially (one at a time), ensuring predictable state management.
