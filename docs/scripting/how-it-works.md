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
## Scripts Always Run Async

Every script is wrapped in an `async` function before it is compiled. That means you never have to opt in to `await`: use it anywhere, in any script block or `js:` field, and the engine waits for the result before it moves to the next block.

### Plain computation
A script with no `await` simply runs to the end and returns.
```javascript
const users = input.users || [];
const activeUsers = users.filter((u) => u.active);
return activeUsers.length;
```

### Waiting on something
Use `await` for calls that take time, such as an external API.
```javascript
const userId = getQueryParam("userId");
const response = await httpClient.get(`https://api.example.com/users/${userId}`);
return response.data;
```

Returning a promise works too: the engine waits for it.
## Runtime Limits and Timeouts

There is no separate time limit for a single script. The **whole run** has one:

- **Routes**: the route's timeout setting (30 seconds by default), enforced by the experimental worker watchdog when `experimental.workerTimeouts.enabled` is on.
- **Workflows**: the workflow's own timeout setting (300 seconds by default).

Keep computations bounded, because an infinite loop blocks the route handler. Give outgoing calls their own timeout, and wrap risky code in `try` and `catch`, or add an **Error Handler** block. See [Execution Limits & Safety](./key-considerations.md).

Not sure which names your code can use in a given place? See [Where Your Code Runs](./environments.md).
