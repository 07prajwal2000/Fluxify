---
title: Response
description: Send the final response and end the workflow.
---

# Response

The **Response** block is used to finish an HTTP request workflow. It sends the final result back to the user or system that triggered the workflow.

## Inputs

- **Http Code**: The status code to return (e.g., 200 for Success, 404 for Not Found).

## Logic

1.  The block takes the data passed from the previous block.
2.  It pairs this data with the selected **Http Code**.
3.  It sends the HTTP response and terminates the workflow.
