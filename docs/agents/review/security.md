---
title: Review recipe - security
description: Security checks for a route or workflow canvas, covering missing auth, unvalidated input, injection, hardcoded secrets and leaked data.
---

# Review recipe - security

Category: `security`. Fix these first. An exploitable problem is always `error`.

## Missing auth on a route that reads or changes data

- **Look for:** a route that reads private data or writes to a database, KV store, queue or another service, and has no auth middleware and no token check (a JWT verification, or a header check that ends in a 401).
- **Severity:** `error` when it writes, or reads user data. `warning` when it reads data that may be public.
- **Fix:** add the project's auth middleware to the route, or check the token first and answer 401 on failure. See [Route with JWT auth](/agents/recipes/route-jwt-auth).

## Request input used without validation

- **Look for:** body, query, params or headers reaching a DB block, DB Native, a JS Runner, an HTTP Request URL or a file path, when the route's `bodySchema`, `querySchema` or `paramsSchema` does not describe that field.
- **Severity:** `error` when it reaches DB Native, a URL or a path. `warning` otherwise.
- **Fix:** describe the field in the route's request schema (type, required, rules, formats). See [Validate a request](/agents/recipes/validate-request).

## Injection through raw queries or built strings

- **Look for:** DB Native or KV Raw whose query is built by joining strings with request values (`js:` code with `+` or template literals around input), instead of passing values as parameters.
- **Severity:** `error`.
- **Fix:** pass values as query parameters. Never put request text into the query itself.

## Server-side request forgery

- **Look for:** an HTTP Request whose host or full URL comes from request input.
- **Severity:** `error`.
- **Fix:** keep the host fixed, and take only a path part or an id from the request, checked against a list.

## Secrets written into blocks

- **Look for:** API keys, passwords, tokens or connection strings typed into a block field or JS code (`sk-...`, `Bearer ...`, `postgres://user:pass@...`).
- **Severity:** `error`.
- **Fix:** move the value to app config as a secret and read it from there.

## Data leaked in a response

- **Look for:** a Response that returns whole database rows (password hashes, tokens, internal ids, fields of other users), or a stack trace or raw error text.
- **Severity:** `error` for credentials or data of other users. `warning` for internal details.
- **Fix:** turn on Transform response and return only the fields the caller needs.

## Missing ownership check

- **Look for:** a route that loads or changes a record by an id from the request, without checking that the record belongs to the caller (the user id from the token is never compared).
- **Severity:** `error`.
- **Fix:** add the caller's id to the query's conditions, or check ownership and answer 403 or 404.
