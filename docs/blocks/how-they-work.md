---
title: How Blocks Work
description: Understanding the execution model of Fluxify blocks.
---

# How Blocks Work

In Fluxify, a **Block** is a self-contained unit of logic. Understanding how they execute is key to building reliable workflows.

## Anatomy of a Block

Every block consists of three main parts:

1.  **Inputs**: Data required for the block to function (e.g., a URL for an HTTP request or a SQL query for a database block). Inputs can be static values or dynamic expressions.
2.  **Execution Logic**: The internal code that performs the operation. This is hidden from the user but runs securely on the server.
3.  **Outputs**: The result of the operation. This data is passed to the next block in the chain and can be accessed via the `input` variable or by referencing the block's ID.

## Data Flow

- **Sequential Execution**: Blocks run one after another. Block B starts only after Block A completes.
- **Passing Data**: The output of Block A is available to Block B. You can use it to drive logic or populate fields.
- **Context**: All blocks have access to the global `vars` context, allowing you to share data across the entire workflow, not just between direct neighbors.

## Dynamic Inputs

Most input fields in Fluxify support **JavaScript Expressions**. By prefixing your input with `js:`, you can write code to calculate the value at runtime.

*Example*:
- Static: `https://api.example.com/users`
- Dynamic: `js: 'https://api.example.com/users/' + input.userId`

## Failures and Errors

If a block fails (e.g., a network error or invalid query), it triggers an error state. You can handle this using the **Error Handler** block to redirect the flow, ensuring your application fails gracefully.
