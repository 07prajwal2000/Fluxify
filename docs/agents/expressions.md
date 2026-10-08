---
title: Dynamic values and js expressions in block inputs
description: How a block text input becomes a dynamic value with the js prefix, what names it can read, which fields accept it, and the mistakes to avoid.
---

# Dynamic values and `js:` expressions in block inputs

Read this before you fill any block field with a value that changes per request, such as an id from the input, a query parameter or a built string. It answers "how do I make this value dynamic".

## The rule for a dynamic value

A dynamic value is one that is worked out per request instead of typed in.

A block text input is a literal unless it starts with `js:`.

- No prefix: the text is saved and used as it is. `input.id` is the nine characters `input.id`, not the id.
- Prefix `js:`: the rest is JavaScript, run at request time. Its result is the value.

```json
{ "key": "userId", "value": "js: return input.userId" }
```

There is no other way to mix text and data. `{{ }}` templates do not exist.

## Write the code after `js:`

After the prefix, write the body of a function and `return` the value.

- `js: return input.userId` gives the user id.
- A bare expression without `return` gives `undefined`. `js: input.userId` is wrong.
- `await` works, so `js: return await httpClient.get(url)` is fine.
- Several statements are fine. Keep short values on one line.
- Nothing is evaluated unless the text starts with exactly `js:`. A space before it, or a different case, makes it a literal.
- Never wrap a value in `{{ }}`. It is saved as plain text.

## What you can read

| Name | What it is |
| :--- | :--- |
| `input` | The output of the block just before this one. |
| `outputs.name` | A block output saved with **Save output to variable**. |
| `trigger` | What started the run. In a workflow, `trigger.data` is the list of events. |
| `params.name` | A custom block's own settings. Only inside a custom block. |
| `getQueryParam("k")`, `getRouteParam("k")`, `getHeader("k")`, `getCookie("k")` | Read the request. Each gives `""` when the value is missing. |
| `getRequestBody()` | The parsed request body. |
| `httpRequestMethod`, `httpRequestRoute` | The method and the path of the request. |
| `getConfig("KEY")` | An app config value. Use it for keys and secrets. |
| `jwt.sign`, `jwt.verify`, `jwt.decode` | Token helpers. |
| `logger.logInfo(...)` | Write a log entry. |
| `httpClient.get(url)` | Call an outside API. |
| a variable you set | A variable made by a Set Variable block, read by its bare name, such as `userId`. |
| `Math`, `JSON`, `Date`, `String` and the other standard JavaScript names | Always there. |

Names that do not exist: `vars`, `cfg` and `data`. `js: return vars.x` and `js: return cfg.KEY` fail. Read a variable by its name and an app config value with `getConfig("KEY")`.

`cfg:KEY` is a different thing. It is the prefix an integration config uses to point at an app config key. It never works in a block field. See [App config reference](/agents/app-config).

The full list of helpers is in [Scripting Context](/scripting/context).

## Which fields accept `js:`

Most text inputs that hold a value accept it:

| Where | Fields |
| :--- | :--- |
| Set Variable, Array Operations | `value` |
| Console Log, Cloud Logs | `message` |
| Response | `httpCode`, for a status that depends on the flow, such as `js: return input.created ? 201 : 200;` |
| HTTP Request | `url`, header names and values, the values inside `body` |
| Get and Set Header, Cookie, Param | `name`, `value`, and for cookies `domain`, `path`, `expiry` |
| Database blocks | `connection`, `tableName`, condition `attribute` and `value`, `limit`, `offset`, `after`, sort `attribute`, and the values inside `value` for Insert and Update |
| KV Operations | `connection`, `key`, `value`, `ttl` |
| If, Switch | condition sides and case values |
| For Loop | `start`, `end`, `step` |
| Send Message | `connection`, `destination`, `key`, header and option values, payload values |
| Trigger Workflow | `runAt`, `scheduleId`, the values inside `data` |
| Custom block | any text parameter |

A value inside an object or a list counts. `{ "headers": { "X-User": "js: return input.id" } }` works.

If you are unsure about a field, call `get_block_schemas` for the block. A field that takes `js:` says so in its description. A field that does not, such as a name chosen from a fixed list, treats `js:` as a literal.

## Fields that are already code

These are already code. Do not add `js:`. Write plain JavaScript that returns the value:

- JS Runner: `value`.
- Transformer: `js`, when `useJs` is on.
- Response: `transformScript`, when `transformEnabled` is on.
- DB Native, KV Raw Connection and Send Message in raw mode: `js`.
- A custom block's code.

A Transformer `fieldMap` is also plain text. It maps a source key to a destination key and never takes `js:`.

```json
{ "value": "return { id: input.id, total: input.price * input.qty };" }
```

Raw SQL conditions on database blocks are the one place `{{ }}` is valid, for SQL parameters. See [Database conditions](/blocks/db-conditions). Everywhere else it is a mistake.

## Build a string

Use a template string with `${ }` inside the `js:` code:

```json
{ "message": "js: return `Hello ${input.name}`" }
```

For a value from the request:

```json
{ "message": "js: return `Hello ${getQueryParam('name')}`" }
```

Fixed text needs no prefix: `"message": "Order created"`.

## Right and wrong

| Want | Wrong | Right |
| :--- | :--- | :--- |
| The id from the previous block | a `{{ }}` template around `input.id` | `js: return input.id` |
| The id from the previous block | `input.id` | `js: return input.id` |
| The id from the previous block | `js: input.id` | `js: return input.id` |
| `Hello ` and a name | `Hello ` plus a `{{ }}` template | ``js: return `Hello ${input.name}` `` |
| A query parameter | `getQueryParam('page')` | `js: return getQueryParam('page')` |
| An app config value | `js: return cfg.API_KEY` | `js: return getConfig('API_KEY')` |
| A variable set earlier | `js: return vars.userId` | `js: return userId` |
| A status code | `js: input.ok ? 200 : 400` | `js: return input.ok ? 200 : 400` |
| Fixed text | `js: return "Order created"` | `Order created` |

The `{{ }}` templates people reach for, which never work:

```text
{{ input.id }}
Hello {{ input.name }}
```

## Common mistakes

| Mistake | What happens | Fix |
| :--- | :--- | :--- |
| No `js:` prefix | The field is the literal text, and the route answers with it. | Start the value with `js:`. |
| `js:` without `return` | The value is `undefined`. | Add `return`. |
| `{{ }}` template | Saved as plain text. | Use `js:` with a template string. |
| `js:` in a code field | The field is already code, so the prefix is not needed there. | Remove the prefix and write plain JavaScript. |
| `vars.`, `cfg.` or `data.` | These names do not exist, and the run fails. | See [What you can read](#what-you-can-read). |

`edit_canvas` with `validate: true` returns a warning for a field that holds a `{{ }}` template or starts with `input.`, `vars.`, `cfg.` or `data.` but has no `js:`. The warning does not stop the save, so read it.

## Related pages

- [Scripting Context](/scripting/context): every name that code can read.
- [Custom block reference](/agents/custom-block): parameters that accept `js:`.
- [Route reference](/agents/route): building the canvas of a route.
