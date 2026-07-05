---
title: How Scripting Works
description: The execution model of Fluxify scripts.
---

# How Scripting Works

Fluxify executes your custom JavaScript code using an isolated, sandboxed Virtual Machine (VM) wrapper defined in `@fluxify/lib` (`JsVM`). This allows scripts to run server-side in a secure runtime sandbox that separates user execution from the host application process.

---

## The Execution Flow

When a workflow runs a script (or evaluates a `js:` input), it follows these four steps:

1. **Extraction**: The execution engine identifies the code segment (e.g. stripping the `js:` prefix if it is an inline expression).
2. **Context Injection**: The engine prepares the global environment by injecting helpers, third-party libraries, and the current workflow's variables (`vars`) as top-level globals in the sandboxed scope.
3. **Sandboxed Evaluation**: The script is executed inside a fresh VM context. If the script is written in a block, it is wrapped in an immediately-invoked function expression (IIFE) to isolate variable declarations.
4. **Result Resolution**: The output value is captured and returned. If the script returns a Promise (e.g., using `async`/`await` or calling async functions like `httpClient`), the VM suspends execution and waits for the Promise to resolve before passing the result to the next block.

---

## Synchronous vs. Asynchronous Execution

Both synchronous logic and modern asynchronous JavaScript (`async/await`) are fully supported.

### Synchronous Script
For plain computations, scripts run to completion in a single pass.
```javascript
// Sync Execution
const users = input.users || [];
const activeUsers = _.filter(users, u => u.active);
return activeUsers.length;
```

### Asynchronous Script
For non-blocking operations, such as calling external APIs, the engine waits for the resolved output.
```javascript
// Async Execution
const userId = getQueryParam("userId");
const response = await httpClient.get(`https://api.example.com/users/${userId}`);
return response.data;
```

---

## Sandbox Limits and Timeouts

To maintain platform stability and protect server resources, script execution is constrained by a strict **4-second (4000ms) execution limit**:

- **Synchronous Timeout**: Synchronous code containing infinite loops (e.g., `while(true)`) is terminated immediately by the VM runtime once the 4-second limit is breached.
- **Asynchronous Timeout**: For async code returning a Promise, the execution engine races your Promise against a 4-second timer. If your Promise does not resolve or reject within 4 seconds, execution is aborted, and a `JavaScript execution timeout` error is thrown.

Any script that exceeds these limits will fail, halting execution of the current path unless custom error routing is defined.
