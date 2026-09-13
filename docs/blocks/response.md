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

## Transform script (optional)

Turn on **Transform response** to reshape the body right before it is sent — no extra JS Runner block needed.

- Off by default. Existing responses are unchanged.
- Write the script in the **Transform** tab. The body comes in as `input`; whatever you `return` is sent.
- The status code stays the one you picked.

```js
return { data: input, meta: { count: input.length } };
```
