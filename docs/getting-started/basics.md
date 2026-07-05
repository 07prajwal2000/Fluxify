---
title: Basics & Core Concepts
description: The fundamental concepts you need to understand to build with Fluxify — Workflows, Blocks, Edges, Context, and Integrations.
---

# Basics & Core Concepts

Fluxify is built around a small set of composable concepts. Understanding these will allow you to model any backend logic visually — from simple CRUD endpoints to AI-powered workflows with complex branching logic.

---

## 1. Workflows (API Endpoints)

A **Workflow** is the fundamental unit of logic in Fluxify. Each workflow represents a single API endpoint — it has a defined HTTP method and path (e.g., `POST /users`), and defines exactly what happens when that endpoint is called.

Every workflow:
- Starts with an **Entrypoint** block that is bound to an HTTP route.
- Flows through one or more action blocks connected by edges.
- Ends when a **Response** block sends a reply, or when the execution engine reaches a block with no outgoing connection.

Workflows are displayed visually as a directed graph (a canvas of blocks and connecting arrows) inside the Fluxify editor.

---

## 2. Blocks

**Blocks** are the individual units of logic that make up a workflow. Each block performs a single, well-defined action. Blocks are the building "lego pieces" of Fluxify — you compose them to express arbitrarily complex backend behaviour.

Every block has:
- **Inputs** — values the block needs to execute (e.g., a table name, a SQL query, a URL).
- **Outputs** — the data the block produces after execution, passed to the next block as `input`.
- **Settings** — configuration options that control the block's behaviour.
- **Connections** — edges that define which block runs next.

Block inputs support **dynamic expressions**: prefix a value with `js:` to evaluate a JavaScript expression at runtime (e.g., `js: input.userId` or `js: jwt.sign({ id: input.id })`).

### Block Categories

| Category | Examples | Purpose |
| :--- | :--- | :--- |
| **Logic & Flow** | Entrypoint, If Condition, For Loop, Error Handler, Response | Control the path of execution |
| **Data** | Set Variable, Get Variable, Transformer, JS Runner, Array Operations | Manipulate and reshape data |
| **HTTP** | HTTP Request, Get Header, Get Query Param, Set Cookie, Get Request Body | Interact with the HTTP layer |
| **Database** | DB Get All, DB Insert, DB Update, DB Delete, DB Native, DB Transaction | Read and write to PostgreSQL |
| **Logging** | Console Log, Cloud Logs | Observability and debugging |

Browse the full [Blocks Reference](../blocks/index.md) for detailed documentation on every block.

---

## 3. Edges (Connections)

**Edges** are the arrows connecting blocks on the canvas. They define the **order of execution** — the directed path the engine follows through the workflow.

Key behaviours:

- If Block A is connected to Block B, Block B runs immediately after Block A finishes successfully.
- Some blocks produce **multiple output ports**. For example, the **If Condition** block has a `True` and a `False` output — the engine follows the matching branch based on the evaluated condition.
- A block with no outgoing edge ends the workflow at that point.

---

## 4. Execution Context & Variables

Every time a request hits a workflow, the engine creates a fresh **Execution Context** — an isolated per-request environment that holds everything the workflow needs:

- **Request data** — the HTTP method, route, headers, cookies, query parameters, and body.
- **Global variable store** — a key-value space shared across all blocks in the same workflow run.
- **The `input` variable** — the output of the immediately preceding block, available in every block and expression.
- **Scripting sandbox** — an isolated JavaScript VM for JS Runner and Transformer blocks.
- **DB connections** — access to configured database integrations.
- **Logger** — structured logging to console or cloud providers.
- **App Config** — project-level secrets referenced as `cfg:MY_KEY`.
- **JWT utilities** — helpers for signing and verifying JSON Web Tokens.

### Variables

You can persist data across blocks in a single workflow run using the **Set Variable** and **Get Variable** blocks, or by assigning values in script blocks:

```javascript
// In a JS Runner — set a variable for later blocks to read
myUserId = input.id;
return input;
```

Variables live only for the lifetime of one request. They are not shared between concurrent requests.

### The `input` Variable

Every block automatically receives the output of the previous block as `input`:

```javascript
// Previous block returned { "name": "Alice", "age": 30 }
return input.name; // → "Alice"
```

For a complete reference, see the [Execution Context](../concepts/context.md) and [Scripting Context](../scripting/context.md) documentation.

---

## 5. Integrations

**Integrations** are the connections between Fluxify and external systems. They are configured once in the project settings and then referenced by blocks using a connection ID.

Currently supported integrations:

| Integration Type | Examples | Used By |
| :--- | :--- | :--- |
| **Databases** | PostgreSQL | All `DB *` blocks |
| **AI Models** | OpenAI, Anthropic | AI blocks (via AI Gateway) |
| **Observability** | Loki, OpenObserve | Cloud Logs block |

Fluxify uses an **Adapter Pattern** internally — blocks interact with a generic interface, so the underlying provider can be changed without modifying the workflow.

Configure integrations in the **Integrations** section of the project dashboard, then reference them in your blocks by their connection ID.

See the [Integrations Reference](../integrations/index.md) for setup guides.

---

## 6. App Config (Secrets)

The **App Config** is a secure key-value store for project-level secrets and configuration values — things like API keys, database passwords, or external service URLs that you don't want to hardcode in your workflows.

Define a key in the App Config (e.g., `OPENAI_API_KEY`), then reference it in any block field with the `cfg:` prefix:

```
cfg:OPENAI_API_KEY
```

This keeps sensitive values out of your workflow definitions and centralises credential management.

---

## Next Steps

Now that you understand the core concepts, you're ready to:

- 🔧 [Set up your local environment](./local-testing.md) to start building
- 🧩 [Browse the Blocks Reference](../blocks/index.md) to see what's available
- ✍️ [Learn about Scripting](../scripting/index.md) for advanced custom logic
- 🧠 [Explore the Concepts section](../concepts/index.md) for deep architectural dives
