---
title: HTTP Client
description: The internal engine for making network requests.
---

# HTTP Client

The **HTTP Client** in Fluxify is the underlying engine that powers the **HTTP Request** block and other network-related features.

## capabilities

It is built on top of the robust **Axios** library, providing:

- **Standard Methods**: Support for GET, POST, PUT, DELETE, PATCH.
- **Consistency**: Handles headers, timeouts, and response parsing uniformly.
- **Integration**: Used internally by integration adapters to communicate with external APIs (like OpenAI or Databases).
