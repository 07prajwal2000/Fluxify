---
title: Response Schemas
description: Save what a route answers for each status code, straight from a real response in the playground.
---

# Response Schemas

A route does not show what its response looks like until someone sends a request. A response schema fixes that: it records the shape of the answer for one status code, so you and your team can see it without calling the route.

A route keeps **one schema per status code**. A route can have a `200` schema, a `404` schema, and so on.

Schemas use the same format as the schema editor you already know from request bodies.

## Save a schema from a response

1. Open the route's **API Playground** and send a request.
2. When the response comes back, click **Save as schema** in the bottom-right corner of the response body.

Fluxify reads the response body and works out the shape for you:

| In the response | In the schema |
| :--- | :--- |
| `"text"` | A string |
| `42` | An integer |
| `1.5` | A float |
| `true` | A boolean |
| An object | An object with one field per key |
| An array | An array, shaped from up to the first 100 items |

Only the **shape** is saved, never the values. A response holding an email address or a token leaves neither behind.

::: info
Fields found in every array item are marked required. Fields found in only some items are optional. Fields that were `null` count as missing. If one position holds different types, the first type is used and the others are added as alternatives.
:::

### When the button is disabled

Hover the button to see why. A schema can only be saved when the request got an answer, the answer has a body, and the body is JSON.

### Saving again replaces the schema

If the status code already has a schema, Fluxify asks before replacing it. Replacing also removes any rules you added by hand, so edit the saved schema instead when you only want to adjust it.

## See and edit your schemas

The request side of the playground has a **Schema** tab next to Params, Headers and Body. A saved schema appears there right away, as one collapsible section per status code (`200`, `400`, `500` and so on).

- Open a status code to see the exact schema that was saved, and edit it with the schema editor. Click **Save** to keep your changes. Nothing is saved while you type.
- Use **New status code** to write a schema by hand, without sending a request first.
- Use the delete button inside a status code to remove its schema.

People with the viewer role can read schemas but not change them.

## In the OpenAPI spec

Saved schemas show up as the `responses` of the route in your project's OpenAPI spec, one entry per status code with its schema. The development spec lists your current schemas. The production spec lists the ones saved in the version that is live, so a schema you have not promoted yet does not appear there. A route with no `200` schema keeps a plain "Successful response" entry.

## Versions

Response schemas are saved with the route's versions, like its path and request schemas:

- Changing a schema counts as an **uncommitted change**, so you can commit it as a new version.
- Opening a version in the version history shows the schemas it had.
- Checking out an older version puts its schemas back. A version made before this feature existed leaves your current schemas as they are.

See [Versioning](/concepts/versioning) for how versions work.
