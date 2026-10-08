---
title: Middleware reference for agents
description: Fields, run order, limits, errors and JSON examples for building a middleware chain with save_middleware.
---

# Middleware reference for agents

A middleware is a named chain of custom blocks. Routes run it **before** or **after** their own logic. Use it for checks and steps that many routes share, such as an API key guard or request logging. For background, see [Middlewares](/concepts/middlewares).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_middlewares` | viewer | Middlewares of a project: id, name, description, `routeCount`, block names. |
| `get_middleware` | viewer | One middleware with its blocks in run order: id, name, label. |
| `save_middleware` | creator | Create (no `middlewareId`) or update (`middlewareId`). |
| `delete_middleware` | creator | Deletes a middleware that no route uses. |

`save_middleware` only builds the chain. Attach it to a route with `save_route`. See [Attach to a route](#attach-to-a-route).

## Attach to a route

Pass `middlewares` to `save_route`. `before` runs before the route's canvas, `after` runs after it. Each list is in run order.

```json
{ "routeId": "<route id>", "middlewares": { "before": ["<middleware id>"] } }
```

- A list you leave out keeps its current ids. `[]` clears it.
- `get_route` shows the attached middlewares, with id and name.
- A middleware can be attached to a route only once, before or after.
- Only middlewares of the route's project can be attached.

## Build a middleware

A middleware chain holds custom blocks with `usage: "middleware"`. Make those first.

1. `save_custom_block` with `usage: "middleware"`. See [Custom block reference](/agents/custom-block). A middleware block takes no input parameters.
2. `edit_canvas` on that block with `kind: "custom_block"` to write its code.
3. `save_middleware` with the block ids in run order.

```json
{
  "projectId": "<project id>",
  "name": "Require API key",
  "description": "Stops requests without a valid key",
  "blocks": ["<custom block id 1>", "<custom block id 2>"]
}
```

The result is `{ "id": "<middleware id>" }`.

## Update a middleware

Pass `middlewareId` and only the fields that change.

```json
{ "middlewareId": "<middleware id>", "blocks": ["<custom block id 2>", "<custom block id 1>"] }
```

`blocks` replaces the whole chain. Send the full list in the order you want, not one change. `[]` empties the chain. Leaving `blocks` out keeps it. `projectId` cannot change.

Changing a middleware recompiles every route that uses it.

## Fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Create only. | none |
| `name` | string | 1 to 255 characters, trimmed. Unique in the project. | none |
| `description` | string | Free text. | none |
| `blocks` | list of ids | Custom block ids of this project with `usage: "middleware"`. Each id once. The list order is the run order. | empty chain |

## How a request flows

1. The **before** middlewares run in the order set on the route.
2. The route runs.
3. The **after** middlewares run in the order set on the route.

Inside the chain, each block passes its output to the next as `input`. The chain carries on across middlewares.

| Step | Its `input` is |
| --- | --- |
| First before middleware | The request body |
| Each later step | The output of the step before it |
| The route | The output of the last before middleware, or the request body when there are none |
| First after middleware | `{ "httpCode": 200, "body": ... }`, the route's reply |

In an after middleware, work on `input.body`. The reply is also available as `getResponseBody()` and `getResponseStatus()`, for the whole after chain.

A before middleware that ends in a `response` block answers the request. The route does not run. That is how a guard says no. A response block in an after middleware sends the wrapper unless **transform** is on. Set `transformEnabled: true` and `transformScript: "return input.body;"` on it to send the body.

Variables are shared. A variable set in a middleware, for example the signed-in user, can be read by later middlewares and by the route.

## Limits

- A middleware can be added to a route once, either before or after it.
- A block can appear in one chain only once.
- A middleware block cannot be placed on a route canvas.
- A middleware block keeps `usage: "middleware"` for life.

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Fluxify API error 409: A middleware named "X" already exists in this project` | Pick another name. |
| `Invalid input: blocks: Each custom block can appear only once` | Remove the duplicate id from `blocks`. |
| `Invalid input: Only this project's middleware custom blocks can be chained` | An id is unknown, from another project, or the block has another `usage`. Check with `list_custom_blocks`. |
| `Fluxify API error 409: Remove this middleware from the N route(s) that use it first.` | `delete_middleware` is refused while routes use the middleware. `list_middlewares` shows `routeCount`. Detach it first: `save_route` with `middlewares` that leave it out. |
| `Fluxify API error 409: Remove this block from <middlewares> first.` | `delete_custom_block` on a block a chain still uses. Update that middleware first. |
| `Invalid input: A middleware can be added to a route only once` | The same id is in `before` and `after`, or twice in one list. |
| `Invalid input: Only this project's middlewares can be added to its routes` | An id is unknown or from another project. Check with `list_middlewares`. |
| `Not found: Middleware not found` | Wrong `middlewareId`. Use `list_middlewares`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |

After a change, check `get_system_logs` for compile errors.
