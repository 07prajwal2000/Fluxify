---
title: Recipe - validate a request
description: Check request input with the route's body, query and params schemas (types, rules, formats, custom JS) instead of regex in a JS Runner block.
---

# Recipe - validate a request

Goal: reject bad input before any block runs, with a ready-made 400.

**Use the route's request schemas first.** `bodySchema`, `querySchema` and `paramsSchema` are set with `save_route`. They check types, required fields, ranges, formats and enums, and answer a failure with a 400 before the canvas starts. Do not write regex or `if` checks in a JS Runner for rules the schema can express. Write your own check only for rules the schema cannot, and put that check in the schema too (step 3).

The full field and rule tables are in the [Route reference](/agents/route#request-schemas).

## 1. Describe the input

Example: `POST /signup` needs a valid email and an age from 18 to 120.

Call `save_route`:

```json
{
  "routeId": "<route id>",
  "bodySchema": {
    "dataType": "object",
    "properties": [
      { "key": "email", "dataType": "str", "required": true,
        "rules": [{ "type": "format", "value": "email", "message": "Enter a valid email" }] },
      { "key": "age", "dataType": "int", "required": true,
        "rules": [{ "type": "min", "value": 18 }, { "type": "max", "value": 120 }] },
      { "key": "newsletter", "dataType": "bool", "required": false, "default": false }
    ]
  }
}
```

(On create, pass `projectId`, `name`, `path` and `method` as well.)

Pick the built-in way for each need:

| Need | Use |
| --- | --- |
| Required or optional, default value | `required`, `default` (a default needs `required: false`) |
| Number range | `int` or `float` with `min` and `max` rules |
| Text length | `str` with `minLength`, `maxLength` |
| Email, URL, UUID, IP, ISO date-time | `str` with a `format` rule: `email`, `url`, `uuidv4`, `uuidv7`, `ipv4`, `ipv6`, `datetime` |
| A text pattern | `str` with a `regex`, `startsWith`, `endsWith`, `contains` or `notContains` rule |
| One of a fixed list | `enum` with a `values` rule |
| List size, list of items | `arr` with `items` and `minItems` or `maxItems` |
| Nested object | `object` with `properties` |
| Uploaded file | `file` or `blob` with `maxSize`, `minSize`, `mimeTypes` |

Query values and path params arrive as text, and are converted, so `"25"` passes `int`. A JSON body is strict: `5` is not `"5"`. Keys you do not declare are kept, not rejected.

Query and path:

```json
{
  "querySchema": { "dataType": "object", "properties": [
    { "key": "page", "dataType": "int", "required": false, "default": 1,
      "rules": [{ "type": "min", "value": 1 }] }
  ] },
  "paramsSchema": { "dataType": "object", "properties": [
    { "key": "id", "dataType": "int", "required": true }
  ] }
}
```

A path with `:id` needs a `paramsSchema` with exactly those keys.

## 2. See the failure

Call `call_route` with bad input:

```json
{ "routeId": "<route id>", "body": { "email": "nope", "age": 12 } }
```

The route answers 400 and no block runs:

```json
{
  "status": 400,
  "body": {
    "message": "Body validation failed",
    "errors": [
      { "path": "email", "property": "email", "errors": ["Enter a valid email"] },
      { "path": "age", "property": "age", "errors": ["<built-in text for min 18>"] }
    ]
  }
}
```

The message is `Query validation failed` for the query and `Path parameters validation failed` for path params. Built-in error texts come from the validator. Only string rules (`str`) take a `message` to replace them.

Then call it with good input and expect your canvas to run.

## 3. A rule the schema cannot express

Set a property's `dataType` to `js` and put the check in its `js` field. The code is the body of a function: `input` is the field's value. Return `true` to pass, or throw a `ValidationError` for a custom message. Do not use the `js:` prefix: the field is already code.

```json
{ "key": "code", "dataType": "js", "required": true,
  "js": "if (!input.startsWith('SALE')) {\n  throw new ValidationError({ code: 'INVALID_CODE', message: 'Discount codes must start with SALE' });\n}\nreturn true;" }
```

- Returning a falsy value fails with `Custom JS validation failed`.
- Whatever you pass to `ValidationError` is returned to the caller as that entry's `errors`.
- A thrown ordinary error is reported with its message.
- The code sees the same request helpers as other code, such as `getHeader` and `getConfig`. See [Dynamic values and `js:` expressions](/agents/expressions).
- It checks one field's value. To compare two fields, check the second in the canvas (an `if` block then a 400 response).

## 4. Keep it tested

Save a test suite with a bad-input case that expects status 400, and a good-input case. See [Write and run a test suite](/agents/recipes/write-and-run-test-suite).

## Common problems

| What you see | What to do |
| --- | --- |
| A JS Runner with a regex checks input | Delete it. Use a `regex` or `format` rule on the field. |
| 400 on every call | Check `required`: fields are required unless `required: false`. |
| `"25"` fails on a JSON body | A JSON body is strict. Send the number `25`, or accept text with a `str` field. |
| `Invalid body schema format` | `dataType` is misspelled or `properties` is not a list. See the [Route reference](/agents/route#request-schemas). |
