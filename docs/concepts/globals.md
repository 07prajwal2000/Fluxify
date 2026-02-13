---
title: Globals
description: Shared state across the application.
---

# Globals

**Globals** refer to data and state that persists beyond a single block's execution.

## Execution Context
Within a single workflow run, `vars` is a global object. You can write to it at the beginning of a workflow and read from it at the end. This is the primary way to pass data around.

## Application State
Some data is global to the entire application instance, such as:
- **Database Connections**: Managed by the connection pool.
- **App Config**: Environment variables loaded at startup.
