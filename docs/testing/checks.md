---
title: Checking the Response
description: Simple checks for status, body, headers and duration, and custom checks written in JavaScript with t.expect.
---

# Checking the Response

Checks (called **assertions** in the editor) decide whether a suite passes. After the route answers, every check runs. The suite passes only if **all** of them hold.

A suite with no checks passes as long as the route runs without crashing.

## Simple checks

Open the **Assertions** tab, press **Add assertion**, and pick a **target**:

| Target | What it looks at | Extra field |
| --- | --- | --- |
| Status code | The HTTP status, for example `200` or `404` | — |
| Response body | The whole body, or one value inside it | **Property path** (optional) |
| Header | One response header | **Header name** |
| Duration (ms) | How long the route took, in milliseconds | — |
| Custom JS | Anything you like, written in JavaScript | See [below](#custom-js-checks) |

Then pick an **operator** and, if it needs one, an **expected value**:

| Operator | Passes when the value… | Works with |
| --- | --- | --- |
| equals | is exactly the expected value | all |
| not equals | is anything but the expected value | all |
| less than | is smaller than the expected number | Status code, Duration |
| greater than | is bigger than the expected number | Status code, Duration |
| contains | has the expected text somewhere in it | Response body, Header |
| is true / is false | is `true` / `false` | Response body, Header |
| exists | is present (not missing and not `null`) | Response body, Header |
| does not exist | is missing or `null` | Response body, Header |

### Property paths

A property path picks one value out of the body. Use dots for objects and `[n]` for list positions (counting from 0).

For this body:

```json
{ "user": { "name": "Ada", "tags": ["admin", "beta"] } }
```

| Property path | Value |
| --- | --- |
| *(empty)* | the whole body |
| `user.name` | `"Ada"` |
| `user.tags[1]` | `"beta"` |
| `user.tags` | `["admin","beta"]` |

## Custom JS checks

When a simple check is not enough, choose **Custom JS** and write checks in JavaScript with `t.expect`:

```js
t.expect(fluxify.response.status).toBe(201);
t.expect(fluxify.response.body.user.email).toContain("@");
t.expect(fluxify.response.body.items).toHaveLength(3);
```

Each `t.expect(...)` line shows up as **its own line in the results**, so a failure tells you exactly what went wrong:

```text
✗ expected 500 to be 201
```

Give a check a name as the second argument to make results easier to read:

```js
t.expect(fluxify.response.status, "status").toBe(201);
// ✗ status: expected 500 to be 201
```

::: warning At least one check
A Custom JS assertion must call `t.expect` at least once. One that does not fails with "Custom JS made no t.expect(...) checks". Returning `true` or `false` does nothing.
:::

A failed check does **not** stop your code: every `t.expect` line runs and is reported. If your code throws an error instead, the assertion fails with that error.

### What you can read

| Name | What it is |
| --- | --- |
| `fluxify.response.status` | The status code |
| `fluxify.response.body` | The body the route returned |
| `fluxify.response.headers` | The response headers (names in lower case) |
| `fluxify.request.path` | The path that was called, with path values filled in |
| `fluxify.request.params` | The path values, for example `{ id: "42" }` |
| `fluxify.request.query` | The query values |
| `fluxify.request.headers` | The request headers |
| `fluxify.request.body` | The request body |
| `t.setup` | What the suite's [setup block](./setup-and-teardown) returned, if it has one |
| `t.zod` | The zod library, to check the shape of a value ([see below](#checking-the-shape-of-data)) |

### `t.expect` checks

| Check | Passes when the value… | Example |
| --- | --- | --- |
| `.toBe(x)` | is exactly `x` (same number, text, `true`/`false`) | `t.expect(status).toBe(200)` |
| `.toEqual(x)` | has the same content as `x`, including inside objects and lists | `t.expect(body).toEqual({ ok: true })` |
| `.toBeTruthy()` | counts as true (not `0`, `""`, `null`, `undefined`, `false`) | `t.expect(body.id).toBeTruthy()` |
| `.toBeFalsy()` | counts as false | `t.expect(body.error).toBeFalsy()` |
| `.toBeNull()` | is `null` | |
| `.toBeUndefined()` | is `undefined` | |
| `.toBeDefined()` | is not `undefined` | |
| `.toContain(x)` | is text containing `x`, or a list containing `x` | `t.expect(body.tags).toContain("admin")` |
| `.toHaveLength(n)` | has length `n` (text or list) | `t.expect(body.items).toHaveLength(3)` |
| `.toHaveProperty(path)` | has a value at `path` | `t.expect(body).toHaveProperty("user.name")` |
| `.toHaveProperty(path, x)` | has `x` at `path` | `t.expect(body).toHaveProperty("user.name", "Ada")` |
| `.toMatch(x)` | is text that contains `x`, or matches the pattern `x` | `t.expect(body.email).toMatch(/@example\.com$/)` |
| `.toBeGreaterThan(n)` | is a number bigger than `n` | |
| `.toBeLessThan(n)` | is a number smaller than `n` | |

Put `.not` in front of any check to flip it:

```js
t.expect(fluxify.response.body.password).not.toBeDefined();
t.expect(fluxify.response.status).not.toBe(500);
```

::: tip `toBe` or `toEqual`?
Use `toBe` for single values such as numbers and text. Use `toEqual` for objects and lists: two objects with the same content are "equal" but not the "same".
:::

### Checking the shape of data

`t.zod` is the [zod](https://zod.dev) library. Use it to check that data has the right shape, without listing every value:

```js
const User = t.zod.object({
  id: t.zod.number(),
  email: t.zod.email(),
  tags: t.zod.array(t.zod.string()),
});

t.expect(User.safeParse(fluxify.response.body).success, "user shape").toBe(true);
```

The editor suggests names as you type `fluxify.`, `t.` and `t.zod.`.
