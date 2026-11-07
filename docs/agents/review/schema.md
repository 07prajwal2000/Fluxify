---
title: Review recipe - schema
description: Schema checks for a route canvas, covering request schemas that disagree with what blocks read and responses whose shape is inconsistent.
---

# Review recipe - schema

Category: `schema`. The route's contract does not match what it actually does.

## Request schema does not match what blocks read

- **Look for:** blocks reading body, query or params fields the schema does not declare, fields declared optional that blocks use with no default, or a schema type that differs from how blocks use the field.
- **Severity:** `warning`. `error` when a missing field reaches a write.
- **Fix:** declare every field the blocks read, with its type, and mark it required or give it a default.

## Response shape differs between branches

- **Look for:** success paths that return different shapes (an object on one path, an array or a bare string on another), or error bodies with different keys (`error` here, `message` there).
- **Severity:** `warning`.
- **Fix:** use one shape for success and one for errors across all paths.

## Response contradicts its declared schema

- **Look for:** a declared response schema or status that a Response block does not follow.
- **Severity:** `warning`.
- **Fix:** change the Response or the schema so they agree.

## Content type mismatch

- **Look for:** a route that reads JSON body fields while accepting form or text content, or a Response that returns JSON with a text content type header.
- **Severity:** `warning`.
- **Fix:** set the route's content type and the response header to match the data.
