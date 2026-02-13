---
title: Set Variable
description: Store a value in the global context.
---

# Set Variable

The **Set Variable** block allows you to save a value into the application's global memory. This value can be a number, text, object, or even the result of a JavaScript expression. Once saved, you can retrieve it later using the **Get Variable** block.

## Inputs

- **Key**: The name you want to give to this variable.
- **Value**: The data you want to store. This can be static text, a number, or dynamic content using JavaScript (by starting with `js:`).

## Logic

1.  The block takes the **Value** you provide.
2.  If the value starts with `js:`, it executes it as code to calculate the final result.
3.  It saves this result under the name specified in **Key**.
4.  The saved value is passed as the output of this block.
