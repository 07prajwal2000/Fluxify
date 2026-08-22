# Fluxify

## What Fluxify is

Fluxify is a backend platform for building, running, and deploying HTTP APIs. A project defines routes, and each route runs a workflow that reads input, performs actions, and returns a response.

Workflows are made from connected blocks. Blocks provide common operations such as reading request data, calling a database, changing values, checking conditions, repeating work, handling errors, and returning a response. JavaScript can be added when a workflow needs custom logic.

## Capabilities

- Build HTTP API routes without writing the full server boilerplate.
- Connect routes to PostgreSQL databases for reading, inserting, updating, and deleting data.
- Combine conditions, loops, variables, transformations, and error handling in one workflow.
- Add JavaScript that runs in Bun for logic not covered by the available blocks.
- Use AI model providers, including OpenAI and Anthropic, inside workflows.
- Produce structured logs and send observability data to services such as Loki and OpenTelemetry-compatible systems.
- Deploy as a Docker container or as a Kubernetes workload.

## Common uses

Fluxify can be used to build:

- CRUD APIs for application data.
- APIs that validate, transform, and route incoming requests.
- Workflows that read from a database, apply business rules, and return a result.
- AI-backed endpoints that send input to a model and return the model result.
- API integrations that combine database operations, custom JavaScript, and external service calls.
- Backend services that need structured logs and container-based deployment.

## Working model

Use these terms consistently:

- **Project**: A Fluxify application containing routes and their configuration.
- **Route**: An HTTP endpoint with a method and path.
- **Workflow**: The ordered set of actions a route performs.
- **Block**: One action in a workflow, such as a database query or condition.
- **Connection**: The link that determines which block runs next.
- **Script**: Custom JavaScript used inside a workflow.

For exact block names, inputs, outputs, defaults, and limitations, use the relevant capability page. This page is only the product-level overview.

## Agent guidance

When handling a Fluxify task:

1. Identify the route, workflow, data, AI, scripting, deployment, or observability capability involved.
2. Read the relevant documentation page before choosing configuration names or values.
3. Treat documented inputs, outputs, defaults, and limitations as authoritative.
4. Keep the request input, workflow result, and HTTP response shape explicit.
5. Use scripting when the required behavior is not available as a documented block.

## Scope and assumptions

- This reference describes the platform behavior available through the documentation set.
- It does not describe the visual editor, screenshots, navigation, or internal implementation.
- A provider, block, deployment target, or option not documented for the relevant capability is not assumed to be supported.
- Details that change per capability belong in that capability's agent reference, not in this overview.
