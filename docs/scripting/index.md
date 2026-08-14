---
title: Introduction to Scripting
description: Extend Fluxify functionalities with custom JavaScript.
---

# Scripting in Fluxify

While Fluxify provides a robust set of built-in blocks, there are times when your workflows require custom logic. Fluxify's scripting features allow you to write standard JavaScript code to manipulate data, execute complex calculations, handle advanced routing or request parsing, and implement custom condition flows.

Fluxify's DAG compiler turns each saved workflow into native JavaScript. Script blocks and `js:` expressions become part of that compiled route, which runs directly in Bun's JavaScript runtime—there is no per-request VM layer.

## Runtime and worker safety

Scripts execute in Bun, not Node.js. Bun uses Apple's JavaScriptCore engine, so the generated route handler can use the native `Bun` global and Bun runtime APIs where they are available in the worker. See the [Bun runtime API reference](https://bun.com/docs/runtime/bun-apis) for the supported native APIs.

Fluxify's worker supervisor is designed to terminate workers that stop behaving safely, such as a route that blocks execution and prevents heartbeats. This protection is currently experimental and only partially implemented: CPU and network-resource policies are still being tracked separately. You can enable strict worker timeouts with the `experimental.workerTimeouts.enabled` project setting. When enabled, each endpoint has a 30-second timeout by default (or its configured route timeout); a stalled worker that exceeds it is terminated by the supervisor.
## Where Scripting Can Be Used

Scripting in Fluxify is divided into two main categories: **dedicated script blocks** and **dynamic inputs/conditions**.

### 1. Dedicated Script Blocks
- **JS Runner Block**: Execute a standalone block of JavaScript code. This block receives optional parameters and produces a custom JSON output for subsequent blocks.
- **Transformer Block**: Specifically designed to reshape and map complex data structures from previous blocks (e.g., modifying database results or API responses) before passing them onward.

### 2. Dynamic Input Fields & Expressions
- **Dynamic Field Inputs (`js:`)**: Many fields inside block editors allow you to write inline JavaScript code by prefixing the value with `js:`. The execution engine evaluates this expression at runtime and uses the result as the block's input.
- **Condition Chains**: Use Javascript expressions within conditional gates (like the **If** block or routing conditions) to evaluate complex truth/falsity assertions.
## Writing Scripts: The `return` Requirement

Every script you write in Fluxify is implicitly wrapped and executed inside an **Immediately Invoked Function Expression (IIFE)**. 

> [!IMPORTANT]
> Because your scripts run inside an IIFE scope, **you must use an explicit `return` statement** to return any data from the script to the workflow. If you omit the `return` statement, the block evaluates to `undefined`, which may lead to errors in downstream blocks.

### Examples

**Correct (explicit return):**
```javascript
// Calculates and returns a formatted value
const rawAmount = input.total;
const taxRate = 0.08;
return rawAmount * (1 + taxRate);
```

**Incorrect (no return):**
```javascript
// This will result in an output of 'undefined'
const rawAmount = input.total;
const taxRate = 0.08;
const total = rawAmount * (1 + taxRate);
```
## Core Execution Concepts

To write effective scripts, you should be familiar with the following three concepts:

- **[Scripting Context](./context.md)**: A global scope injected with helper functions (`getQueryParam`, `setHeader`, `jwt.sign`), third-party libraries (Zod, Underscore, Day.js), and workflow state variable definitions.
- **[Imports & Libraries](./imports.md)**: Load modules with standard `import` syntax. Imports are hoisted, so they cost nothing per request.
- **The `input` Variable**: A special local variable containing the outputs of the block immediately preceding the script block.
- **[Execution Limits & Safety](./key-considerations.md)**: Runtime timeouts and defensive scripting practices for keeping routes reliable.
