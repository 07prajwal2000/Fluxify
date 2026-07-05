---
title: Key Considerations & Common Pitfalls
description: Important limits, pitfalls, and behaviors that can cause 500 errors or crash API routes.
---

# Key Considerations & Common Pitfalls

Because Fluxify runs your custom scripts on the server, writing improper code can cause workflow execution failures, return `500 Internal Server Error` statuses to clients, or degrade server-wide performance. 

Pay close attention to the following constraints and pitfalls when scripting.

---

## 1. Global Variable Mutation (Context Corruption)

Every block in a workflow execution shares the **same mutable context object**. Any global helper variables (like `setHeader`, `logger`, `jwt`, `libs`, `getConfig`, etc.) are injected as properties into this context.

> [!CAUTION]
> Overwriting or deleting these built-in globals will corrupt the environment for the current run.
> 
> For example, running `setHeader = null;` or `delete libs;` in a script will make that helper unavailable. Any subsequent block or expression in the workflow attempting to use it will throw a `TypeError: setHeader is not a function`, instantly halting the workflow and returning a `500 Internal Server Error` to the caller.

### Best Practice
- Treat all built-in global functions and objects as **read-only**.
- Avoid assigning values to variables without declaring them (`const`, `let`, `var`), as this writes them to the shared global scope.
- Never use variable names that shadow built-in globals:
  ```javascript
  // ❌ BAD: Shadows the built-in HTTP request helper
  const getHeader = "my-header"; 
  
  // ❌ BAD: Destroys the built-in logger reference for subsequent blocks
  logger = null; 
  ```

---

## 2. Missing `return` Statements

All user scripts are implicitly wrapped in an Immediately Invoked Function Expression (IIFE).

> [!WARNING]
> If your script does not explicitly use a `return` statement, it will return `undefined`.
> 
> Downstream blocks often expect the output of a JS Runner or Transformer block to be a JSON object or string. If your script returns `undefined`, subsequent blocks trying to read properties (e.g. `input.data`) will throw a runtime error like `TypeError: Cannot read properties of undefined`, causing the workflow to fail with a `500` error.

### Best Practice
- Always return a value, even if it is just a success status or empty object:
  ```javascript
  // Always return something
  return { success: true };
  ```

---

## 3. Unresolved Async Promises (Resource Leaks)

Fluxify supports `async/await` and races asynchronous promises against a 4-second timeout.

> [!IMPORTANT]
> If an asynchronous promise runs past 4 seconds, the execution engine times out, aborts the request, and returns a `500` error (or routes to your error handler). However, **the underlying promise continues to execute in the background** on the server's event loop.
> 
> If a script leaks unresolved database connections, infinite fetch loops, or un-ending timeouts, these background jobs accumulate. Over time, they will exhaust server resources (socket handles, database pool connections, memory), eventually crashing the entire application server.

### Best Practice
- Always specify timeouts on external fetches or operations (e.g., using Axios timeouts in `httpClient`).
- Ensure all promises resolve or reject under all circumstances.

---

## 4. Unhandled Runtime Exceptions

Executing operations on unverified inputs (like calling a method on `null` or `undefined`) throws runtime exceptions.

```javascript
// ❌ RISKY: If input.user is null, this throws "Cannot read properties of null (reading 'email')"
return input.user.email;
```

If an unhandled exception is thrown inside a script:
- The execution engine terminates the workflow immediately.
- If no **Error Handler Block** is configured, the server returns a `500 Internal Server Error` status containing the raw stack trace.

### Best Practice
- Always sanitize and validate input variables using Zod or standard null-checks:
  ```javascript
  // Option A: Optional chaining
  return input?.user?.email || null;
  
  // Option B: Standard validation
  if (!input || !input.user) {
    logger.logWarn("User not found in input");
    return null;
  }
  return input.user.email;
  ```
- Always configure an **Error Handler Block** in your workflow to catch script failures and return client-friendly JSON responses instead of 500 errors.

---

## 5. Memory Exhaustion

Scripts run in-process on the server. If a script allocates massive structures (e.g. loading a 100MB database result, or infinite loops appending to a string), it can exhaust process memory. This will cause the garbage collector to consume 100% CPU or trigger an Out-Of-Memory (OOM) crash of the entire server instance, knocking out all API routes.

### Best Practice
- Never process massive datasets inside workflow script blocks. Use paginated queries or external database transformations.
- Avoid nesting loops that allocate memory dynamically.
