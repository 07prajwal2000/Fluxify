---
title: How Scripting Works
description: The execution model of Fluxify scripts.
---

# How Scripting Works

Fluxify compiles the workflow DAG into one native JavaScript route handler. JavaScript from script blocks and `js:` expressions is emitted into that handler and runs directly in Bun's JavaScript runtime. There is no separate VM or graph traversal on the request path.
## The Execution Flow

When you save a workflow, the compiler prepares its script code in four steps:

1. **DAG compilation**: The compiler walks the workflow from its entrypoint and emits a native JavaScript function for the route.
2. **Script integration**: Script blocks and `js:` expressions are transformed into the generated function with their request context and workflow state available at runtime.
3. **Import analysis**: The AST parser finds static `import` declarations, hoists them from request-time code, and resolves them once during compilation.
4. **Direct execution**: Workers receive the compiled handler and execute it directly in Bun for every matching request. Async code uses normal JavaScript `await` semantics.
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
## Runtime Limits and Timeouts

To maintain platform stability and protect server resources, script execution is constrained by a strict **4-second (4000ms) execution limit**:

- **Synchronous code**: Keep computations bounded; an infinite loop blocks the route handler.
- **Asynchronous code**: Awaited operations must resolve within the route execution limit or the request fails.

Any script that exceeds these limits will fail, halting execution of the current path unless custom error routing is defined.
