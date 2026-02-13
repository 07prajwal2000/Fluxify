---
title: Get Variable
description: Retrieve a variable from the global context.
---

# Get Variable

The **Get Variable** block retrieves a value that was previously stored in the application's global memory (context). This is useful for accessing data you've saved earlier in your workflow.

## Inputs

- **Key**: The name of the variable you want to retrieve.

## Logic

1.  The block looks for a variable with the specified **Key**.
2.  If found, it outputs the value of that variable.
3.  This value can then be used by subsequent blocks in your workflow.
