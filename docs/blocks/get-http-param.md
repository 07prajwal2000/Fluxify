---
title: Get HTTP Param
description: Retrieve values from the URL query or path.
---

# Get HTTP Param

The **Get HTTP Param** block extracts specific values from the URL.

## Inputs

- **Name**: The name of the parameter.
- **Source**: Where to look for the parameter:
    - `query`: From the question mark onwards (e.g., `?id=123`).
    - `path`: From the URL path itself (e.g., `/users/123`).

## Logic

1.  The block checks the URL based on the **Source** selected.
2.  It finds the value corresponding to **Name**.
3.  It returns that value.
