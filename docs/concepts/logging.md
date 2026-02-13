---
title: Logging System
description: How Fluxify handles application logs.
---

# Logging System

Fluxify features a flexible logging system that supports multiple outputs (transports).

## Architecture

- **Abstract Logger**: The core interface that defines how logs are handled.
- **Levels**: Supports distinct log levels:
    - `Info`: General operational events.
    - `Warn`: Potential issues that didn't stop execution.
    - `Error`: Critical failures.

## Transports

Logs can be sent to different destinations:
1.  **Console**: Prints logs to the server's standard output (useful for local development).
2.  **Cloud Providers**: Connectors for buffering and sending logs to services like **Loki** or **OpenObserve**. This ensures you can monitor your workflows in production without losing data.
