---
title: Getting Started
description: A complete introduction to Fluxify — what it is, how it works, and how to get up and running quickly.
---

# Getting Started with Fluxify

**Fluxify** is an open-source, low-code backend platform. You design APIs and background jobs on a visual canvas, and Fluxify turns them into fast, running code — without you writing boilerplate server code.

> [!NOTE]
> Fluxify is currently in **alpha**. The platform is under active development and some features are still stabilizing. Feedback, bug reports, and contributions are very welcome.

## What is Fluxify?

Instead of writing route handlers, middleware, and data-access layers by hand, you build with **blocks** connected by **edges** on a canvas. Two kinds of canvas cover most backends:

- A **route** answers an HTTP request. It has a method and a path, and the caller waits for the response.
- A **[workflow](../concepts/workflows.md)** is background work. It starts from a schedule, a message, or another workflow, and nobody waits for it.

A typical route might:

1. Accept an incoming HTTP request via an **Entrypoint** block
2. Read the request body with a **Get Request Body** block
3. Look up a record with a **DB Get Single** block
4. Fetch extra data from another service with an **HTTP Request** block
5. Shape the result with a **Transformer** or **JS Runner** block
6. Return a JSON response with a **Response** block

All of this is configured visually in the browser — no server framework knowledge required. Prefer to describe it in words? The **AI assistant** can build a route on the canvas for you, and you can edit what it builds like any other route.

## Core Capabilities

| Capability | Description |
| :--- | :--- |
| 🧩 **Visual Builder** | Drag blocks onto a canvas to design backend logic — conditions, loops, parallel steps, and error handling included |
| ⚡ **Compiled Routes** | Your canvas is translated to JavaScript once, when you save. Requests run that code directly in Bun |
| 🤖 **AI Assistant** | Describe a route and the assistant places and connects the blocks. Works with OpenAI, Anthropic, Gemini, Mistral, or any OpenAI-compatible server |
| 🗄️ **Databases & Caches** | Blocks for PostgreSQL, MySQL, and MongoDB — query, insert, update, delete, transactions, plus raw queries. Redis and Memcached for caching |
| ⏱️ **Workflows, Schedules & Triggers** | Run background work on a cron, an interval, a one-off time, or when a Redis stream message arrives. Kafka, NATS JetStream, and Amazon SQS triggers need an Enterprise license |
| 📜 **Custom Scripting** | Write JavaScript for advanced transformations, custom logic, or JWT handling, and package your own reusable blocks |
| 🔗 **HTTP Networking** | Call external APIs, read headers and cookies, and shape responses — all with dedicated HTTP blocks |
| 🧪 **Test Suites** | Check a route or workflow against requests and rules you write, and re-run it after every change |
| 📡 **Observability** | Structured logging with Grafana Loki and OpenTelemetry Logs; console logging for local development |
| 🔒 **Secrets** | Per-project App Config keeps keys and passwords out of your canvases |
| 🚀 **Self-Hosting** | One container (`fluxify-kit`) to try it out, or admin plus scalable workers on Docker or Kubernetes for production |

## How It Works

Every route in Fluxify is a canvas of blocks. When you save it, Fluxify translates it to JavaScript, and your workers pick it up. When a request arrives, Fluxify:

1. **Matches** the request to the right route by its method and path.
2. **Creates** a per-request [Execution Context](../concepts/context.md) — an isolated environment holding request data, variables, database connections, and the logger.
3. **Runs** the compiled JavaScript, passing each block's output as `input` to the next.
4. **Handles errors** by following the Error Handler block if any block fails.
5. **Enforces** the route's timeout (30 seconds by default) to stop runaway routes, when the experimental worker timeouts setting is on.
6. **Returns** the final block's output as the HTTP response.

For a deep dive, see the [Execution Engine](../concepts/execution-engine.md) and [Architecture](../architecture/index.md) pages.

## In This Section

| Page | Description |
| :--- | :--- |
| [Basics & Core Concepts](./basics.md) | Understand Routes, Workflows, Blocks, Edges, Variables, and Integrations |
| [Routing & Validation](./routing.md) | How requests are matched, validated, and answered |
| [Local Testing](./local-testing.md) | Set up a full Fluxify stack locally for development and testing |
| [Self-Hosting](../deployments/index.md) | Run Fluxify on your own infrastructure, from a single container to Kubernetes |
| [Contributing](./contributing.md) | Learn how to contribute code, docs, or ideas to the project |

## Quick Links

- 📖 [Blocks Reference](../blocks/index.md) — Browse all available blocks
- 🧠 [Concepts](../concepts/index.md) — Deep-dive into how Fluxify thinks
- 🔌 [Integrations](../integrations/index.md) — Databases, caches, queues, AI models, and logging
- ✍️ [Scripting](../scripting/index.md) — Write custom JavaScript in your canvases
- 🧪 [Test Suites](../testing/index.md) — Check your routes automatically
- 🚀 [Deployments](../deployments/index.md) — From a one-command Kit to production
- 💬 [GitHub Discussions](https://github.com/fluxify-rest/Fluxify/discussions) — Ask questions and share ideas
- 🐛 [GitHub Issues](https://github.com/fluxify-rest/Fluxify/issues) — Report bugs or request features
