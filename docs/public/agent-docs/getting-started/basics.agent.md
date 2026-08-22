# Building a Fluxify Route

## Route and workflow model

- A route is an HTTP method and path, such as `POST /users`.
- A workflow is the sequence of actions that runs when the route receives a matching request.
- Every workflow starts with an **Entrypoint** block.
- Blocks are connected in execution order.
- A **Response** block sends the HTTP response. A path with no next connection also ends.

## How blocks work

Each block has settings, inputs, outputs, and connections.

- Settings configure the block.
- Inputs can be fixed values or dynamic `js:` expressions.
- The output of the previous block is available as `input` in the next block.
- The output of the current block becomes the next block's `input`.
- A branch block chooses one outgoing connection; an error handler can receive a failed path.

Example script output:

```javascript
return { userId: input.id, name: input.name };
```

The next block receives that object as `input`.

## Route construction sequence

1. Choose the HTTP method and path.
2. Start with an Entrypoint block.
3. Add blocks for request data, validation, database work, external calls, conditions, loops, or transformations.
4. Connect blocks in the order they should run.
5. Add an Error Handler path for failures that need a controlled response.
6. End successful paths with a Response block.

## Request data and state

- Request values include the method, path parameters, query parameters, headers, cookies, and body.
- `input` carries the previous block's output.
- Runtime variables hold temporary values for the current request and can be reused by later blocks.
- App Config stores project settings and secrets. A field can reference a value with `cfg:KEY_NAME`.
- Runtime state is isolated per request and disappears after the request finishes.

## Dynamic values and scripts

Many block fields accept a `js:` expression, such as `js: input.userId` or `js: getQueryParam("page")`.

JS Runner and Transformer code runs as part of the route's JavaScript handler. Each script must return the value that the next block should receive:

```javascript
const page = Number(getQueryParam("page") || 1);
return { page, previous: input };
```

Use the [JavaScript API Reference](../scripting/javascript-api.agent.md) for available request helpers, response helpers, configuration, HTTP, JWT, logging, libraries, and database access.

## Agent use

- Use this page for the overall route and data-flow model.
- Use the [block catalog](../blocks/list-of-blocks.agent.md) to select a block.
- Use the [execution context reference](../concepts/context.agent.md) for request values and runtime state.
- Use a block's detailed page for exact settings and limitations.

Do not infer support for a block, provider, field, or option that is not documented.
