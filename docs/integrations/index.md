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

## Production and development values

Every integration holds a **production** config and a **development** config
under one name. Blocks and triggers refer to the integration, so the same route
works in both environments: the production worker uses the production config and
the [development worker](/concepts/environments) uses the development one.

| Setting | What the development worker uses |
| --- | --- |
| **Its own config** (default) | The development config. With none set, a run that uses the integration fails and says `integration <name> has no development value`. It never falls back to production. |
| **Same as production** | The production config. |

`cfg:` references in each config are read from the same environment's
[App Config](/concepts/app-config#production-and-development-values).

::: warning Use separate development instances
Point the development config at its own database, queue or topic, and key-value
store, as you would when coding a backend by hand. Triggers use the same consumer
group names in both environments, so a development config that points at a
production queue takes production's messages.
:::

::: danger Same as production means development uses production
Development runs, development triggers and the AI agent read and write your
production service. Turn it on only when that is safe.
:::

### Testing a connection

| Action | Credentials it uses |
| --- | --- |
| **Test connection** (portal, API, MCP) | **Development**. For an integration set to *Same as production*, that is the production config. |
| Browsing a database's tables and columns | **Development**, the same way. |
| **Test production credentials** | **Production**. Only a signed-in person using the portal can run it. API tokens, MCP and the AI agent cannot. |

If development has no config and *Same as production* is off, testing says so
and asks you to set one.

## Categories

- [**Databases**](./databases.md): Connect to PostgreSQL, MySQL, or MongoDB.
- [**KV Stores**](./kv-stores.md): Connect to Redis, Memcached, Valkey, DragonflyDB, and more.
- [**Observability**](./observability.md): Send logs to Loki or OpenTelemetry Logs.
- [**AI Models**](./ai-models.md): Power the AI assistant with OpenAI, Claude, Gemini, Mistral, or any OpenAI-compatible server.
- [**Message Queues**](./message-queues.md): Start workflows from messages on a Kafka topic or a NATS JetStream stream.
