---
title: Getting Started
description: A complete introduction to Fluxify — what it is, how it works, and how to get up and running quickly.
---

# Getting Started with Fluxify

**Fluxify** is an open-source, no/low-code backend engine that lets you design, deploy, and scale APIs entirely through a visual workflow builder — without writing boilerplate server code.

> [!NOTE]
> Fluxify is currently in **alpha**. The platform is under active development and some features are still stabilizing. Feedback, bug reports, and contributions are very welcome.

---

## What is Fluxify?

Fluxify is a visual backend platform. Instead of writing route handlers, middleware, and data-access layers manually, you build **workflows** — directed graphs of **Blocks** connected by **Edges** — that define exactly what happens when an HTTP request arrives.

A typical workflow might:

1. Accept an incoming HTTP request via an **Entrypoint** block
2. Read the request body with a **Get Request Body** block
3. Query a PostgreSQL database with a **DB Get Single** block
4. Call an AI model (OpenAI / Anthropic) with an **AI Block**
5. Transform the result with a **Transformer** or **JS Runner** block
6. Return a JSON response with a **Response** block

All of this is configured visually in the browser — no server framework knowledge required.

---

## Core Capabilities

| Capability | Description |
| :--- | :--- |
| 🧩 **Visual Workflow Builder** | Drag-and-drop blocks onto a canvas to design backend logic — loops, conditions, and error handling included |
| 🗄️ **Database Integration** | Purpose-built PostgreSQL blocks for querying, inserting, updating, and deleting records — with raw SQL support |
| 🤖 **AI / LLM Integration** | First-class blocks for calling OpenAI, Anthropic, and other AI providers directly from your workflows |
| 📜 **Custom Scripting** | Write JavaScript in a secure sandboxed VM for advanced transformations, custom routing, or JWT handling |
| 🔗 **HTTP Networking** | Call external APIs, inspect headers, manage cookies, and shape responses — all with dedicated HTTP blocks |
| 📡 **Observability** | Structured logging with support for Loki and OpenObserve; built-in console logging for local development |
| 🔒 **Security** | Per-project App Config for secrets management, encrypted credentials, and sandbox isolation for scripts |
| 🚀 **Flexible Deployment** | Ship as a standalone Docker container (via `fluxify-kit`), or scale with Kubernetes for high availability |

---

## How It Works

Every API endpoint in Fluxify is powered by a **workflow**. The platform runs a lightweight execution engine that:

1. **Matches** an incoming HTTP request to the correct workflow via its Entrypoint block.
2. **Creates** a per-request [Execution Context](../concepts/context.md) — an isolated environment holding request data, global variables, the scripting VM, DB connections, and the logger.
3. **Runs** blocks sequentially, passing each block's output as `input` to the next.
4. **Handles errors** by routing to a configured Error Handler block if any block fails.
5. **Enforces** a 4-second execution timeout to prevent runaway workflows.
6. **Returns** the final block's output as the HTTP response.

For a deep dive, see the [Execution Engine](../concepts/execution-engine.md) documentation.

---

## In This Section

| Page | Description |
| :--- | :--- |
| [Basics & Core Concepts](./basics.md) | Understand Workflows, Blocks, Edges, Variables, and Integrations |
| [Local Testing](./local-testing.md) | Set up a full Fluxify stack locally for development and testing |
| [Self-Hosting](../deployments/index.md) | Deploy Fluxify on your own infrastructure with Docker |
| [Contributing](./contributing.md) | Learn how to contribute code, docs, or ideas to the project |

---

## Quick Links

- 📖 [Blocks Reference](../blocks/index.md) — Browse all available blocks
- 🧠 [Concepts](../concepts/index.md) — Deep-dive into the architecture
- ✍️ [Scripting](../scripting/index.md) — Write custom JavaScript in workflows
- 🚀 [Deployments](../deployments/index.md) — Production deployment guides
- 💬 [GitHub Discussions](https://github.com/fluxify-rest/Fluxify/discussions) — Ask questions and share ideas
- 🐛 [GitHub Issues](https://github.com/fluxify-rest/Fluxify/issues) — Report bugs or request features