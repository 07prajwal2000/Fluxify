---
title: Integrations
description: Connecting to external systems.
---

# Integrations Concept

**Integrations** are the bridges between Fluxify and the rest of your technical ecosystem.

## Adapter Pattern

Fluxify uses the **Adapter Pattern** to handle integrations.
- **Interface**: We define a standard interface (e.g., `IDbAdapter`).
- **Implementation**: Concrete classes (like `PostgresAdapter`) implement this interface.

This means the core system doesn't care if you are using PostgreSQL, MySQL, or SQLite. It just talks to the generic "Database Adapter."

## Benefits

- **Switching Providers**: You can switch underlying technologies (e.g., swapping OpenAI for Anthropic) with minimal changes to your workflows.
- **Unified config**: All credentials and settings are managed in one central place.
