---
title: Route reference for agents
description: Fields, defaults, limits, errors and JSON examples for creating and updating an HTTP route with save_route.
---

# Route reference for agents

A route is an HTTP endpoint: a method and a path. `save_route` sets its settings. Its logic is a canvas of blocks, edited with `get_canvas` and `edit_canvas`; read the [Canvas guide](/agents/canvas) first. For background, see [Routing](/getting-started/routing).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_routes` | viewer | Routes of a project: id, name, method, path, active. Args: `projectId`, `page`, `search`. |
| `get_route` | viewer | Settings, the three request schemas and the attached middlewares. Not the canvas. |
| `save_route` | creator | Create (no `routeId`) or update (`routeId`). |
| `delete_route` | creator | Deletes the route and its canvas. Its path then answers 404. |
| `call_route` | creator | Sends one real request to an active route. When it fails, also returns the real error (`error`). |
| `get_canvas`, `edit_canvas` | viewer, creator | Read and change the blocks. `kind` is `"route"`. |

## Create a route

Pass `projectId`, `name`, `path` and `method`. Everything else is optional.

```json
{
  "projectId": "<project id>",
  "name": "Get user",
  "path": "/users/:id",
  "method": "GET",
  "active": true,
  "paramsSchema": {
    "dataType": "object",
    "properties": [{ "key": "id", "dataType": "int", "required": true }]
  }
}
```

The result is `{ "id": "<route id>" }`.

A new route starts with three blocks: an entrypoint, a response block with `httpCode` `"200"`, and an error handler. Call `get_canvas` to see them and their edges before you edit.

A block text input is a literal unless it starts with `js:`, and `js:` code must `return` the value. See [Dynamic values and `js:` expressions](/agents/expressions) before you fill a block field.

A new route is **inactive**. Pass `active: true`, or real callers and `call_route` are refused. Activate it only once its canvas is ready.

## Update a route

Pass `routeId` and only the fields that change. Fields you leave out keep their value.

```json
{ "routeId": "<route id>", "active": true, "recordExecution": true }
```

`projectId` cannot change. Sending `null` for `bodySchema`, `querySchema` or `paramsSchema` removes that schema.

## Fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Create only. Project id from `list_projects`. | none |
| `name` | string | 2 to 255 characters. Must be unique. | none |
| `path` | string | See [Path rules](#path-rules). | none |
| `method` | string | `GET`, `POST`, `PUT` or `DELETE`. | none |
| `active` | boolean | Only active routes answer callers. | `false` |
| `timeoutSeconds` | integer | At least 30. There is no upper limit. | `30` |
| `tracingEnabled` | boolean | Sends spans to the project's own telemetry destination. Stores nothing in Fluxify. | `false` |
| `recordExecution` | boolean | Keeps a debug recording of each run. See [Recording](#recording-and-tracing). | `false` |
| `acceptedContentTypes` | string list | At least one of the values in [Content types](#content-types). | `["application/json"]` |
| `bodySchema` | object or null | Checks the request body. See [Request schemas](#request-schemas). | none |
| `querySchema` | object or null | Checks the query string. | none |
| `paramsSchema` | object or null | Checks the path params. Required when the path has `:params`. | none |
| `middlewares` | `{ before?, after? }` | Middleware ids from `list_middlewares`, in run order. See [Attach to a route](/agents/middleware#attach-to-a-route). | none |

## Path rules

- It starts with `/`.
- It holds only letters, digits, `-`, `/` and `:`. No underscores, dots or `//`.
- `:name` marks a path param, as in `/users/:id/posts/:postId`.
- The same method and path cannot be used twice. A route name cannot repeat either.

Valid: `/users`, `/users/:id`, `/v1/order-items`. Rejected: `/user_list`, `/users/`, `//users`, `users`.

## Request schemas

`bodySchema`, `querySchema` and `paramsSchema` use Fluxify's own format. They are not JSON Schema. A request that fails the schema is answered with a validation error before the canvas runs. Use these schemas for input checks, not regex in a JS Runner. See [Validate a request](/agents/recipes/validate-request).

```json
{
  "dataType": "object",
  "properties": [
    { "key": "email", "dataType": "str", "required": true,
      "rules": [{ "type": "format", "value": "email" }] },
    { "key": "age", "dataType": "int", "required": false, "default": 18,
      "rules": [{ "type": "min", "value": 0 }, { "type": "max", "value": 120 }] },
    { "key": "role", "dataType": "enum",
      "rules": [{ "type": "values", "value": ["admin", "member"] }] },
    { "key": "tags", "dataType": "arr", "items": { "key": "tag", "dataType": "str" },
      "rules": [{ "type": "maxItems", "value": 10 }] }
  ]
}
```

### Data types

| `dataType` | Meaning |
| --- | --- |
| `str`, `int`, `float`, `bool` | Plain values. `int` must be a whole number. |
| `object` | Takes `properties`, a list of fields. Keys you do not declare are kept, not rejected. |
| `arr` | Takes `items`, one field that describes every element. |
| `enum` | One of the values in a `values` rule. |
| `file` | One uploaded file from a `multipart/form-data` body. |
| `blob` | A raw binary body (`application/octet-stream`). |
| `js` | Your own check in the `js` field. The code returns `true`, or throws `ValidationError` with a message. |

### Field properties

| Property | Meaning |
| --- | --- |
| `key` | The field name. Required on every property. |
| `dataType` | One of the types above. Required. |
| `required` | Fields are required unless you set `false`. |
| `default` | Used when an optional field is missing. Needs `required: false`. |
| `rules` | List of `{ "type": "...", "value": ..., "message": "..." }`. |
| `properties`, `items` | Children of an `object` or `arr`. |

### Rules by type

| Type | Rule `type` values |
| --- | --- |
| `str` | `minLength`, `maxLength`, `regex`, `startsWith`, `endsWith`, `contains`, `notContains`, `format` |
| `int`, `float` | `min`, `max` |
| `arr` | `minItems`, `maxItems` |
| `file`, `blob` | `maxSize` and `minSize` (bytes), `mimeTypes` (a list or comma-separated text) |
| `enum` | `values` (a list) |

`format` takes `uuidv4`, `uuidv7`, `email`, `url`, `ipv4`, `ipv6` or `datetime`. Only the string rules use `message` as the error text. A rule that does not fit the data type is ignored.

### Where each schema reads from

| Schema | Reads | Notes |
| --- | --- | --- |
| `bodySchema` | The request body | A JSON body is strict: the number `5` is not the text `"5"`. A form body (`urlencoded` or `multipart`) is converted, since every form value is text. |
| `querySchema` | The query string | Values arrive as text. They are converted, so `"25"` passes `int`. |
| `paramsSchema` | The `:params` of the path | Must be an `object` with one property per `:param` and no others. Values are converted like the query. |

A request that fails is answered with status 400 and `{ "message": "Body validation failed", "errors": [...] }`. The message is `Query validation failed` or `Path parameters validation failed` for the other two.

A path with no `:params` cannot have a `paramsSchema`. On update, if the new path has no `:params`, the old `paramsSchema` is cleared for you.

## Content types

`acceptedContentTypes` can hold any of these:

- `application/json`
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- `application/octet-stream`
- `text/plain`

A request with another content type is refused with 415.

## Recording and tracing

They are two separate switches.

- `recordExecution: true` keeps each run inside Fluxify. You read it with `list_recordings` and `get_recording`. Recordings hold request headers, bodies and secrets as they were, so use it while debugging and turn it off after. See [Recipe, debug and fix a route or workflow](/agents/recipes/debug-and-fix).
- `tracingEnabled: true` sends spans to the project's own telemetry destination. It keeps nothing in Fluxify.

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Invalid input: path: Must be a valid URL path` | The path has a character outside the allowed set. |
| `Invalid input: paramsSchema: Route path parameters require a paramsSchema` | The path has `:params` and no `paramsSchema`. |
| `paramsSchema: Path parameter 'id' is missing from paramsSchema` | Add a property with that `key`. |
| `paramsSchema: paramsSchema contains parameter 'x' which is not in the route path` | Remove the extra property or add `:x` to the path. |
| `Invalid body schema format` | The schema does not follow the format above. Check `dataType` spelling and that `properties` is a list. |
| `Invalid input: timeoutSeconds: ...` | The value is below 30 or not a whole number. |
| `Fluxify API error 409: A route named "x" already exists in this project ...` | Route names are unique per project. Pick another name. |
| `Fluxify API error 409: GET /users/:id is already taken by ...` | Another route has this method on the same path. Param names do not count: `/users/:id` and `/users/:userId` are the same path. Other methods on that path are fine. |
| `Not found: Route not found` | Wrong `routeId`. Use `list_routes`. |
| `Route is not active — activate it to call it` | `call_route` on an inactive route. Update with `active: true`. |
| `Missing path param "id"` | `call_route` needs `params` for every `:param`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |

After a change, check `get_system_logs` for compile errors.
