---
title: Routing & Request Validation
description: How Fluxify maps incoming requests to your API workflows, validates request data, and returns errors to clients.
---

# Routing & Request Validation

When someone calls your API, Fluxify automatically figures out which workflow to run, checks the request data against your defined rules, and only then starts executing your logic. This page explains how that works and what your callers can expect to receive.
## How Requests Are Matched

Every route you create in Fluxify has an HTTP method (like `GET` or `POST`) and a URL path (like `/users/:id`). When a request comes in, Fluxify matches it to the right workflow instantly.

- If a match is found, the workflow runs.
- If nothing matches, the caller gets a `404` response.

Path parameters like `:id` or `:slug` are captured automatically and made available inside your workflow.

::: tip Hot Reloading
Routes update in real time. When you create or change a route in the dashboard, the change takes effect immediately — no server restart needed.
:::
## Experimental CPU-Stall Timeout

Every route has a `timeoutSeconds` setting. It defaults to **30 seconds** and
can only be increased. The setting is carried with the compiled route whenever
you save it, so a timeout change takes effect through the normal route hot
reload path.

The timeout becomes active only when the project's experimental worker-timeout
policy is enabled:

```bash
curl -X PUT "http://localhost:8080/_/admin/api/v1/projects/<project-id>/settings/keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access-token>" \
  -d '{"key":"experimental.workerTimeouts.enabled","value":"true"}'
```

This policy detects synchronous CPU stalls, such as an infinite loop in custom
JavaScript. It does **not** time out a long asynchronous operation while the
execution process remains responsive. When a CPU stall exceeds the configured
route timeout, the in-flight connection is dropped and only the isolated
execution process is replaced; the worker container continues receiving NATS
hot updates.

When the policy is disabled (the default), no execution heartbeats or timeout
tracking are created.

## What Happens Before Your Workflow Runs

Before Fluxify executes a single block in your workflow, it runs through a quick validation pipeline:

1. **Match the route** — find the right workflow for this request.
2. **Check the content type** — make sure the caller sent a format this route accepts.
3. **Parse the request body** — turn it into data your blocks can use.
4. **Validate the body** — check it against your Body Schema (if set).
5. **Validate query parameters** — check URL query strings against your Query Schema (if set).
6. **Validate path parameters** — check URL path values against your Params Schema (if set).
7. **Run your workflow** — only if everything above passed.

If any validation step fails, the workflow never runs and the caller immediately gets a clear error response.
## Accepted Content Types

A route declares which body formats it accepts. New routes accept
**`application/json`** only; choose more under **Accepted content types** when
you create the route.

| Content type | What your workflow receives |
| :--- | :--- |
| `application/json` | The parsed JSON value |
| `application/x-www-form-urlencoded` | An object of field names and text values |
| `multipart/form-data` | An object of text fields plus any uploaded files |
| `application/octet-stream` | The raw binary body |
| `text/plain` | The text as sent |

A request in any other format — or in a format this particular route wasn't set
up for — is rejected with `415` and the workflow never runs. `GET` and `DELETE`
requests carry no body at all.

::: tip Bodies have a size limit
8 MB by default, and larger requests get a `413`. See
[request body size](../deployments/production.md#request-body-size).
:::

## Request Validation

Each route optionally has three schemas you can configure in the Schema Editor:

| Schema | What It Validates |
| :--- | :--- |
| **Body Schema** | The JSON data in the request body (`POST`, `PUT`) |
| **Query Schema** | URL query parameters (e.g. `?page=2&limit=10`) |
| **Params Schema** | URL path values (e.g. the `42` in `/users/42`) |

You only need to configure the ones that matter for your route — unused schemas are simply skipped.

### Available Data Types

| Type | What It Accepts |
| :--- | :--- |
| `String` | Any text, with optional rules like minimum length, maximum length, or a required format |
| `Integer` | A whole number, with optional min/max |
| `Float` | A decimal number, with optional min/max |
| `Boolean` | `true` or `false` |
| `Array` | A list of items, with optional min/max item count |
| `Object` | A structured set of named fields (can be nested) |
| `Enum` | One specific value from a predefined list |
| `File` | An uploaded file from a `multipart/form-data` request, with optional size and file-type rules |
| `Blob` | A raw binary body (`application/octet-stream`), with optional size rules |
| `Use JavaScript` | Custom validation logic you write yourself |

### Marking Fields as Required

Each field in your schema can be marked as **required** or optional. Required fields must be present — if they're missing, the request is rejected with an error.

### Custom JavaScript Validation

For rules that can't be expressed with the built-in types, you can switch a field to **Use JavaScript** and write your own logic. Your code receives the field's value and should either return `true` (validation passes) or throw a `ValidationError` with a custom message.

```javascript
// Example: reject discount codes that don't start with "SALE"
if (!input.startsWith("SALE")) {
  throw new ValidationError({
    code: "INVALID_CODE",
    message: "Discount codes must start with SALE"
  });
}
return true;
```

Whatever you pass to `ValidationError` is returned directly to the caller — giving you full control over your error messages.

Validation schemas and their trusted JavaScript validators are compiled when a
route artifact loads or hot-reloads. Requests only call the cached validator;
they never compile schema definitions or request-provided `js:` strings. Values
received from a caller are always treated as data, including strings beginning
with `js:`.

## Validation Error Response

When a request fails validation, the caller receives a `400 Bad Request` with a JSON body that clearly describes what went wrong.

```json
{
  "message": "Body validation failed",
  "errors": [
    {
      "path": "address.zipCode",
      "property": "zipCode",
      "errors": ["String must contain at least 5 character(s)"]
    },
    {
      "path": "age",
      "property": "age",
      "errors": ["Expected number, received string"]
    }
  ]
}
```

| Field | Description |
| :--- | :--- |
| `message` | Which part of the request failed: body, query, or path parameters |
| `errors[].path` | The full path to the failing field using dot notation (e.g. `address.zipCode`) |
| `errors[].property` | Just the field name that failed (e.g. `zipCode`) |
| `errors[].errors` | One or more error messages for that field |

When a custom JavaScript validator throws a `ValidationError`, its payload appears verbatim in `errors[].errors` — exactly as you wrote it.
## Error Responses at a Glance

Here's every possible outcome and what the caller receives:

| Situation | Status | Response |
| :--- | :--- | :--- |
| Route doesn't exist | `404` | `{ "message": "Route not found" }` |
| Content type not accepted | `415` | `{ "message": "Unsupported content type ..." }` |
| Body too large | `413` | `{ "message": "Request body exceeds the ...KB limit" }` |
| Body couldn't be read | `400` | `{ "message": "Malformed ... body: ..." }` |
| Validation failed | `400` | `{ "message": "...", "errors": [...] }` |
| Workflow error | `500` | `{ "error": "description" }` |
| Unexpected crash | `500` | `{ "message": "Internal server error" }` |
| Success | `200` | Whatever your Response block returns |

::: info Custom Status Codes
Your workflow can return any HTTP status code you choose using the **Response** block — the defaults above only apply when no status is explicitly set.
:::
## Next Steps

- 🧩 [Explore the Blocks Reference](../blocks/index.md) — build the workflow logic that runs after validation
- ✍️ [Scripting Guide](../scripting/index.md) — learn more about writing custom JavaScript
- ⚙️ [App Config](../concepts/app-config.md) — manage secrets your validators can reference
