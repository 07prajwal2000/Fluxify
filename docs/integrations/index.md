---
title: Integrations
description: Connect with 3rd party services.
---

# Integrations

Extend the capabilities of your workflows by connecting to external services.
Integrations are the bridges between Fluxify and the rest of your technical ecosystem.

## Adapter Pattern

Fluxify uses the **Adapter Pattern** to handle integrations.
- **Interface**: We define a standard interface (e.g., `IDbAdapter`).
- **Implementation**: Concrete classes (like `PostgresAdapter`) implement this interface.

This means the core system doesn't care if you are using PostgreSQL, MySQL, or SQLite. It just talks to the generic "Database Adapter."

## Benefits

- **Switching Providers**: You can switch underlying technologies (e.g., swapping OpenAI for Anthropic) with minimal changes to your workflows.
- **Unified config**: All credentials and settings are managed in one central place.

## Categories

- [**Databases**](./databases.md): Connect to PostgreSQL.
- [**KV Stores**](./kv-stores.md): Connect to Redis, Memcached, Valkey, DragonflyDB, and more.
- [**Observability**](./observability.md): Send logs to Loki or OpenTelemetry Logs.
- [**AI Models**](./ai-models.md): Use LLMs like OpenAI, Claude, and Gemini.
- [**Message Queues**](./message-queues.md): Start workflows from messages on a Kafka topic.
