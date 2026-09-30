---
title: Transformer
description: Reshape an object into a new one, by renaming fields or with JavaScript.
---

# Transformer

The **Transformer** block turns the data it receives into a new shape. You can pick and rename fields with a simple map, or switch to JavaScript for anything more involved.

## When to use it

- Rename fields to match what another service or your caller expects, like `first_name` to `firstName`.
- Keep only the fields you want to send on, and drop the rest.
- Do bigger reshaping in JavaScript: combine fields, turn a list into an object, change every item in a list.
- Don't use it to add or remove items in a list. Use [Array Operations](./array-operations.md).
- Don't use it to make a decision. Use [If Condition](./if-condition.md) or [Switch](./switch.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Field Map** | When **Use JS** is off | empty | Pairs of *source field* and *new name*. Each pair copies one field of the input to a field of the new object. |
| **Use JS** | No | off | On: ignore the Field Map and build the result with a script instead. |
| **JS** | When **Use JS** is on | empty | The script. The data is available as `input`, and whatever you `return` is the result. |
| **Save output to variable** | No | off | Store the result in `outputs.<name>`. |

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always. The next block receives the new object. |

## Example

The input is:

```json
{ "first_name": "Avery", "last_name": "Stone", "age": 31 }
```

**With the Field Map:**

| Source field | New name |
| --- | --- |
| `first_name` | `firstName` |
| `last_name` | `lastName` |

Result (`age` was not in the map, so it is dropped):

```json
{ "firstName": "Avery", "lastName": "Stone" }
```

**With JS** (turn **Use JS** on):

```js
return { fullName: input.first_name + " " + input.last_name, isAdult: input.age >= 18 };
```

Result:

```json
{ "fullName": "Avery Stone", "isAdult": true }
```

## How it behaves

- **The Field Map builds a brand new object.** Only the fields in the map are copied. Everything else is dropped.
- **Top-level fields only.** The map reads `input["first_name"]`. It can't reach into `address.city`. Use JS for nested fields.
- **A missing field is left out.** If the input doesn't have a mapped field, the new object simply won't have it. It is not an error.
- **The map needs an object.** If the input is empty (`null`), the block fails and the [Error Handler](./error-handler.md) runs. To reshape a list, use JS, for example `return input.map(x => ({ id: x.id }));`.
- **Use JS wins.** With **Use JS** on, the Field Map is ignored, but it is kept, so you can switch back.
- **Script errors fail the block.** A script that throws an error triggers the [Error Handler](./error-handler.md).

## Related blocks

- [JS Runner](./js-runner.md): run any code, not only reshaping.
- [Array Operations](./array-operations.md): add, remove or filter items in a list.
- [Response](./response.md): its **Transform response** option reshapes the body right before sending.
- [HTTP Request](./http-request.md): reshape an API answer before you use it.
