---
title: Error Handler
description: Catch and handle errors in the workflow.
---

# Error Handler

The **Error Handler** block allows you to define what happens if something goes wrong. Instead of the workflow crashing, you can redirect the flow to a specific path.

## Inputs

- **Next**: The ID of the block to execute if an error occurs.

## Logic

1.  This block is triggered when an error occurs in a connected block.
2.  It captures the error message.
3.  It redirects the workflow to the block specified in **Next**.
