---
title: Introduction to Scripting
description: Extend Fluxify functionalities with custom JavaScript.
---

# Scripting

While Fluxify provides a robust set of built-in blocks, sometimes you need custom logic to solve specific problems. Fluxify's scripting capabilities allow you to write standard JavaScript code to manipulate data, perform complex calculations, or handle advanced logic flows.

## Where can you use scripting?

You can use scripting in several places within Fluxify:

1.  **JS Runner Block**: Execute a standalone block of JavaScript code.
2.  **Transformer Block**: Use JavaScript to reshape complex data structures.
3.  **Block Inputs**: Many block inputs support dynamic values prefixed with `js:`, allowing you to calculate the input value at runtime.
4.  **Condition Chains**: Evaluate complex conditions using JavaScript expressions.

## The Environment

Scripts run in a secure, sandboxed environment (Virtual Machine). This ensures safety and stability but introduces some limitations compared to a full Node.js environment (e.g., no direct file system access).

## Key Concepts

- **Context**: Access global variables and helper functions.
- **Input**: Receive data from previous blocks.
- **Safety**: Timeouts and strict memory limits.