---
title: Introduction to Scripting
description: Extend Fluxify functionalities with custom JavaScript.
---

# Scripting in Fluxify

While Fluxify provides a robust set of built-in blocks, there are times when your workflows require custom logic. Fluxify's scripting features allow you to write standard JavaScript code to manipulate data, execute complex calculations, handle advanced routing or request parsing, and implement custom condition flows.

All user scripts are executed on the server in a secure, isolated sandbox environment (Virtual Machine). This ensures safety and stability while running high-performance computations.

---

## Where Scripting Can Be Used

Scripting in Fluxify is divided into two main categories: **dedicated script blocks** and **dynamic inputs/conditions**.

### 1. Dedicated Script Blocks
- **JS Runner Block**: Execute a standalone block of JavaScript code. This block receives optional parameters and produces a custom JSON output for subsequent blocks.
- **Transformer Block**: Specifically designed to reshape and map complex data structures from previous blocks (e.g., modifying database results or API responses) before passing them onward.

### 2. Dynamic Input Fields & Expressions
- **Dynamic Field Inputs (`js:`)**: Many fields inside block editors allow you to write inline JavaScript code by prefixing the value with `js:`. The execution engine evaluates this expression at runtime and uses the result as the block's input.
- **Condition Chains**: Use Javascript expressions within conditional gates (like the **If** block or routing conditions) to evaluate complex truth/falsity assertions.

---

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

---

## Core Execution Concepts

To write effective scripts, you should be familiar with the following three concepts:

- **[Scripting Context](./context.md)**: A global scope injected with helper functions (`getQueryParam`, `setHeader`, `jwt.sign`), third-party libraries (Zod, Underscore, Day.js), and workflow state variable definitions.
- **The `input` Variable**: A special local variable containing the outputs of the block immediately preceding the script block.
- **[Execution Limits & Safety](./key-considerations.md)**: Strict runtime timeouts (4 seconds) and sandbox isolations designed to prevent resource abuse and guarantee API availability.