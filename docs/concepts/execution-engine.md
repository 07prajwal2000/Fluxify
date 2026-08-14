---
title: Execution Engine
description: The core system that runs your workflows block by block, manages the execution context, and handles errors.
---

# Execution Engine

The **Execution Engine** is the runtime core of Fluxify. Every time an HTTP request is matched to a workflow, the engine takes over — it walks the block graph, passes data between steps, manages failures, and enforces time limits.
## How the Engine Runs a Workflow

When a request arrives, the server assembles an [Execution Context](./context.md) and then calls the engine's `start()` method with the ID of the first block to run (the **Entrypoint**).

```
Incoming Request
      │
      ▼
 Context Created (vars, scripting helpers, DB)
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
5. **Final result**: The last `BlockOutput` is returned to the request router, which serializes it into an HTTP response.
## The Context & The Engine

The `Engine` receives the [Execution Context](./context.md) in its `EngineOptions`. It does not read request data directly — all request awareness comes from the context:

```typescript
export type EngineOptions = {
  errorHandlerId: string;          // ID of the fallback Error Handler block
  context: Context;                // The full execution context
};
```

Every block receives the full context via its constructor, giving it access to scripting helpers, the logger, DB, and HTTP client.

## Route Timeout

Route timeouts are opt-in through the experimental `experimental.workerTimeouts.enabled` project setting. When enabled, each route has a 30-second timeout by default, or a configured timeout for that route. The worker supervisor can terminate a stalled worker that exceeds the route limit.

> **Tip**: Keep database queries and external HTTP calls bounded and avoid unnecessary sequential round-trips. The worker-timeout protection is experimental and does not replace application-level timeouts for external services.
## Error Handling

Every workflow must have an **Error Handler** block configured. The engine uses its ID (`errorHandlerId`) to route failures.

**Failure flow:**
1. Block throws an exception or returns `successful: false` with `continueIfFail: false`.
2. Engine calls `errorBlock.executeAsync(error)`.
3. If the error block returns a `next` block ID, execution resumes from there.
4. If the error block has no `next`, the last failure result is returned.

**`continueIfFail` flag**: A block can signal that even on failure the engine should proceed to `next`. This is used by blocks like **JS Runner** (which always sets `continueIfFail: true` on success).
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
## Relationship to the Context

The engine is intentionally thin — it knows nothing about HTTP, databases, or scripting. All of that lives in the **Context** that surrounds it:

| Concern | Handled by |
| :--- | :--- |
| Request parsing | `handleRequest()` in the request router |
| Variable state | `vars` in the Context |
| Script execution | Native JavaScript emitted by the DAG compiler and executed in Bun |
| DB access | `context.dbFactory` |
| Outgoing HTTP | `context.httpClient` |
| Logging | `context.vars.logger` |
| Route timeout | Experimental worker supervisor (when enabled) |

See [Execution Context](./context.md) for the full context reference.
## Performance

The engine is designed to be lightweight:
- **No I/O in the loop**: The engine itself does zero I/O. All I/O happens inside blocks.
- **Concurrent requests**: Because each request gets its own isolated context and engine instance, many requests can run in parallel without interference.
- **Single-threaded execution per workflow**: Blocks within one workflow run sequentially (one at a time), ensuring predictable state management.
