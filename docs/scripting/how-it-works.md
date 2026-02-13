---
title: How Scripting Works
description: The execution model of Fluxify scripts.
---

# How Scripting Works

Fluxify executes your JavaScript code using a custom Virtual Machine (VM) wrapper found in `@fluxify/lib`.

## The execution Flow

1.  **Parsing**: When a block encounters a field starting with `js:` or a script block, it isolates the code.
2.  **Context Injection**: The system creates a temporary "Context" object. This includes the `input` data, global variables (`vars`), and helper functions.
3.  **Sandboxed Run**: The code is executed inside a V8 sandbox (using Node.js `vm` module). This isolates it from the host server.
4.  **Result Handling**:
    - If the script returns a value, it is captured.
    - If the script is asynchronous (`async/await`), the system waits for the promise to resolve.
    - The result is passed back to the workflow as the block's output.

## Syntax

You can write standard JavaScript (ES6+).

### Example: Simple Calculation
```javascript
// Input might be { "count": 10 }
return input.count * 2;
```

### Example: Using Globals
```javascript
const userId = vars.currentUserId;
logger.logInfo("Processing for user: " + userId);
return { success: true };
```

### Example: Asynchronous Code
```javascript
// Although direct network calls (fetch) are restricted,
// async syntax is supported for future extensibility or internal async helpers.
const result = await someInternalAsyncHelper();
return result;
```
