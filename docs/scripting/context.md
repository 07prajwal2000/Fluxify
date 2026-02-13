---
title: Scripting Context
description: Variables and functions available to your scripts.
---

# Scripting Context

When your script runs, it has access to a `context` object containing helpful data and utilities. Here is what is available:

## Global Variables

- **`input`**: The data passed to the current block. In block inputs (prefixed with `js:`), this often refers to the specific field's logical input or the output of the preceding block.
- **`vars`**: A global collection of variables set via the **Set Variable** block. You can read and modify these to pass data across your workflow.

## HTTP Helpers

Functions to interact with the incoming HTTP request and prepare the response:

- **`getQueryParam(key)`**: Get a value from the URL query string (e.g., `?search=term`).
- **`getRouteParam(key)`**: Get a value from the URL path pattern (e.g., `/users/:id`).
- **`getHeader(key)`**: Get a generic request header.
- **`setHeader(key, value)`**: Set a header on the outgoing response.
- **`getCookie(key)`**: Retrieve a specific cookie.
- **`setCookie(name, { value, domain, path, expiry, httpOnly, secure, samesite })`**: Set a cookie on the response.
- **`getRequestBody()`**: Get the parsed body of the incoming request.

## System Utilities

- **`logger`**: Access logging functions.
    - `logger.logInfo(message)`
    - `logger.logWarn(message)`
    - `logger.logError(message)`
- **`getConfig(key)`**: Retrieve application-level configuration values (e.g., API keys stored in environment variables or config maps).

## Database (Native Block Only)

- **`dbQuery(sql)`**: When using the **DB Native** block, this function allows you to execute raw SQL queries against your connected database.
