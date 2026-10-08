---
title: Recipe - route with JWT auth
description: Step by step tool calls that build a route which accepts only requests with a valid JWT and answers 401 otherwise.
---

# Recipe - route with JWT auth

Goal: `GET /me` returns the caller's user id and role when the request carries a valid `Authorization: Bearer <token>` header. Any other request gets a 401.

The signing secret lives in app config. The check is one `jsrunner` block followed by an `if` block. Fields and rules are in the [Route reference](/agents/route), [App config reference](/agents/app-config) and [Test suite reference](/agents/test-suite).

## 1. Find the project

Call `list_projects`:

```json
{}
```

Take the `id` of the project. Below it is `<project id>`.

## 2. Store the secret

Ask the person for the signing secret. Do not invent one or print it back.

Call `save_app_config`:

```json
{
  "projectId": "<project id>",
  "keyName": "JWT_SECRET",
  "value": "<the secret>",
  "description": "Secret that signs and checks JWTs",
  "isEncrypted": true,
  "encodingType": "plaintext"
}
```

It answers `{ "id": 7 }`. A `409 Key already exists` means the key is already there. Use `list_app_config` and keep it.

## 3. Create the route, inactive

Call `save_route`:

```json
{
  "projectId": "<project id>",
  "name": "Who am I",
  "path": "/me",
  "method": "GET"
}
```

It answers `{ "id": "<route id>" }`. A new route is inactive, so nobody can reach it while you build.

## 4. Read the canvas

Call `get_canvas`:

```json
{ "target": { "kind": "route", "id": "<route id>" } }
```

You get `version`, `blocks` and `edges`. Note three ids: the `entrypoint` block (`<entry id>`), the `response` block with `httpCode` `"200"` (`<ok response id>`), and the `version`.

## 5. Build the check

Pass the `version` you just read. Three new blocks make the flow:

1. `verify` reads the header and checks the token.
2. `check` branches on the result.
3. `denied` answers 401 on the failure branch. The existing 200 response is the success branch.

A block text input is a literal unless it starts with `js:`, and `js:` code must `return` the value. See [Dynamic values and `js:` expressions](/agents/expressions) before you fill a block field.

Call `edit_canvas`:

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "version": 0,
  "validate": true,
  "ops": [
    { "op": "add_block", "ref": "verify", "type": "jsrunner",
      "data": { "value": "const token = (getHeader('Authorization') || '').replace('Bearer ', '');\nconst { success, payload } = jwt.verify(token, getConfig('JWT_SECRET'));\nif (!success) return { ok: false, error: 'Invalid or missing token' };\nreturn { ok: true, userId: payload.sub, role: payload.role };" },
      "connect_from": { "from": "<entry id>" } },
    { "op": "add_block", "ref": "check", "type": "if",
      "data": { "conditions": [ { "lhs": "js:return input.ok", "rhs": true, "operator": "eq", "chain": "and" } ] },
      "connect_from": { "from": "verify" } },
    { "op": "connect", "from": "check", "to": "<ok response id>", "handle": "success" },
    { "op": "add_block", "ref": "denied", "type": "response",
      "data": { "httpCode": "401" },
      "connect_from": { "from": "check", "handle": "failure" } }
  ]
}
```

If `get_canvas` showed an edge from the entrypoint to the response block, add `{ "op": "disconnect", "from": "<entry id>", "to": "<ok response id>" }` as the first op. A handle holds one edge, so the connect would be refused without it.

The answer has the new `version`, `refs` and, with `validate`, any `issues`. Errors are refused and nothing is saved. Warnings still save.

The body of a response is the output of the block before it. The 200 answer is `{ "ok": true, "userId": "...", "role": "..." }`. The 401 answer is `{ "ok": false, "error": "Invalid or missing token" }`.

## 6. Check the logs, then switch it on

Call `get_system_logs`:

```json
{ "projectId": "<project id>", "level": "error", "resourceId": "<route id>" }
```

An empty list means it compiled. Then activate:

Call `save_route`:

```json
{ "routeId": "<route id>", "active": true }
```

## 7. Try it

No token must fail:

Call `call_route`:

```json
{ "routeId": "<route id>" }
```

Expect `status: 401`. Then with a token signed by the same secret:

Call `call_route`:

```json
{ "routeId": "<route id>", "headers": { "Authorization": "Bearer <token>" } }
```

Expect `status: 200`. Ask the person for a token. `jwt.sign({ sub: "u1", role: "admin" }, secret)` makes one.

## 8. Keep it tested

Save both cases as a test suite and run it. See [Recipe, write and run a test suite](/agents/recipes/write-and-run-test-suite). The 401 case needs no token. For the 200 case, sign a token in the suite's setup block and read it as `t.setup`.

## Reuse the check on many routes

A guard repeated on many routes belongs in a [middleware](/agents/middleware). Make a custom block with `usage: "middleware"` that holds the same `jsrunner` and `if`. End its failure branch in a `response` block with `httpCode` `"401"`, which stops the request before the route runs. Chain it in `save_middleware`. Attach it to each route with `save_route` and `middlewares: { before: ["<middleware id>"] }`.

## Common problems

| What you see | What to do |
| --- | --- |
| `call_route` says `Route is not active` | Run `save_route` with `active: true`. |
| Always 401, even with a good token | The secret differs. The token must be signed with the `JWT_SECRET` value. Header must start with `Bearer `. |
| `jwt` or `getConfig` is not defined | The code must run in a `jsrunner` block or a `js:` field, not a plain text field. |
| `edit_canvas` says `Canvas changed since you read it` | Call `get_canvas` again and redo the edit with the new `version`. |
| 500 and an error in `get_system_logs` | Read the message. A script error names the block. Use [Recipe, debug a failing route](/agents/recipes/debug-route-with-recording). |
