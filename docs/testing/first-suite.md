---
title: Your First Test Suite
description: Create a test suite, describe the request, add a check, and run it.
---

# Your First Test Suite

This guide walks through a complete suite for a simple route: `GET /users/:id`, which returns a user.

## 1. Open the Tests tab

Open the route and choose **Tests** (next to **Canvas**).

## 2. Create a suite

Press **New suite**. A suite called "New suite" appears in the list. Click its name at the top of the editor and give it a name that says what it proves, for example `Returns the user`.

## 3. Describe the request

The **Request** tab is the request the suite sends to the route.

| Field | What to put there | Example |
| --- | --- | --- |
| Description | A sentence about what this suite proves (optional) | `A known user comes back with status 200` |
| Path parameters | A value for each `:name` in the route's path | `id` → `42` |
| Query parameters | Values after `?` in the address | `include` → `profile` |
| Headers | Request headers | `Authorization` → `Bearer test-token` |
| Body | The request body (only for methods that take a body, such as POST and PUT). Pick a content type first; see below | `{ "name": "Ada" }` |

### Sending a form, a file or raw data

The body has a content type picker with the formats the route accepts. The
suite remembers your choice and sends that format.

| Content type | How you fill in the body |
| --- | --- |
| `application/json`, `text/plain` | Type it into the editor |
| Form types | Fill in the fields. In `multipart/form-data` a field can hold a file |
| `application/octet-stream` | Choose a file, or paste the data as base64 |

Files are saved with the suite, so each one must be **1 MB or smaller**. The
route receives them exactly as it would from a real upload.

::: tip
If you leave a path parameter empty, the request will not match the route and the suite fails with a clear message. Fill in every one.
:::

## 4. Add a check

Open the **Assertions** tab and press **Add assertion**. Set it to:

| Target | Operator | Expected value |
| --- | --- | --- |
| Status code | equals | `200` |

Add a second one to check the body:

| Target | Property path | Operator | Expected value |
| --- | --- | --- | --- |
| Response body | `id` | equals | `42` |

See [Checking the response](./checks) for every kind of check.

## 5. Save and run

Press **Save**, then **Run suite**. The result appears on the right within a few seconds.

- A green tick means the suite **passed**: every check held.
- A red cross means it **failed** or hit an **error**. Click the row to see which check failed and what the route actually answered.

Press **Run all** at the top to run every suite of the route at once.

::: warning A worker must be running
Suites run on the same servers that serve your routes. If none is running for this project, the run stops with "No worker is serving this project's routes". Start one, then run again. See [Reading results](./results#common-problems).
:::

## Next steps

- Write richer checks in JavaScript: [Custom JS checks](./checks#custom-js-checks)
- Skip a database call and use made-up data instead: [Hooks](./hooks)
- Add test data before the suite and remove it after: [Setup and teardown](./setup-and-teardown)
