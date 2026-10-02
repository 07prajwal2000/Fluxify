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

This means the core system doesn't care if you are using PostgreSQL, MySQL, or MongoDB. It just talks to the generic "Database Adapter."

## Benefits

- **Switching Providers**: You can switch underlying technologies (e.g., moving from PostgreSQL to MySQL) with minimal changes to your routes.
- **Unified config**: All credentials and settings are managed in one central place.

## Categories

- [**Databases**](./databases.md): Connect to PostgreSQL, MySQL, or MongoDB.
- [**KV Stores**](./kv-stores.md): Connect to Redis, Memcached, Valkey, DragonflyDB, and more.
- [**Observability**](./observability.md): Send logs to Loki or OpenTelemetry Logs.
- [**AI Models**](./ai-models.md): Power the AI assistant with OpenAI, Claude, Gemini, Mistral, or any OpenAI-compatible server.
- [**Message Queues**](./message-queues.md): Start workflows from messages on a Kafka topic or a NATS JetStream stream.
