---
title: JS Runner
description: Write your own JavaScript for anything the other blocks don't cover.
---

# JS Runner

The **JS Runner** block runs JavaScript that you write. It receives the data from the previous block as `input`, and whatever you `return` goes to the next block. It is the most flexible block, for logic that no other block covers.

## When to use it

- Do custom calculations or business rules, like prices, discounts or scoring.
- Combine several values, or reshape data in a way the [Transformer](./transformer.md) field map can't.
- Read request details, call an API with `httpClient`, verify a JWT, or validate data with `zod`.
- Don't use it when a dedicated block exists. [If Condition](./if-condition.md), [Set Variable](./set-var.md) and the [DB blocks](./db-get-all.md) are easier to read and show up clearly on the canvas.
- Don't use it to branch the flow. It has one **Next** handle. Compute the answer here and follow it with an [If Condition](./if-condition.md) or [Switch](./switch.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Value** | Yes | none | The JavaScript code. Modern syntax works, including `async` and `await`. |

Available as plain names in your code:

| Name | What it is |
| --- | --- |
| `input` | The previous block's output. |
| `getRouteParam(k)`, `getQueryParam(k)`, `getHeader(k)`, `getCookie(k)`, `getRequestBody()` | Read the request. |
| `setHeader(k, v)`, `setCookie(name, options)` | Add to the response. |
| `getConfig(key)` | Read a value from [App Config](../concepts/app-config.md). |
| `httpClient` | Call other services. |
| `logger` | `logInfo`, `logWarn` and `logError`. |
| `jwt`, `dayjs`, `_`, `zod` | Ready-made libraries for tokens, dates, utilities and validation. |

The full list, with types, is in the [Scripting Context](../scripting/context.md) reference. You can also `import` supported libraries, see [Imports & Libraries](../scripting/imports.md).

## Outputs

| Handle | When it is used |
| --- | --- |
| **Next** (right) | Always, when the code finishes. The next block receives the value you `return`. |

If your code doesn't `return` anything, the next block gets an empty value.

## Example

The previous block returned `{ "price": 100, "taxRate": 0.08 }`. Code:

```js
const total = input.price * (1 + input.taxRate);
return { total: total.toFixed(2) };
```

The next block receives:

```json
{ "total": "108.00" }
```

More examples, like reading the request, calling an API and verifying a token, are on [JS Runner examples](./js-runner-examples.md).

## How it behaves

- **You must `return` a value.** Without `return`, nothing is passed on.
- **A thrown error fails the block.** The [Error Handler](./error-handler.md) runs. To handle an error yourself, wrap the code in `try` and `catch` and return a result.
- **Variables.** A name you assign without `const`, `let` or `var`, like `userId = 7;`, is saved as a request variable that [Get Variable](./get-var.md) and later blocks can read. Names declared with `const` or `let` stay inside this block.
- **No `require()`.** Use `import` at the top of the code.
- **Time limit.** Keep long waits short. The whole route has its own time limit.
- **It replaces the flowing data** with what you return.

## Related blocks

- [Transformer](./transformer.md): reshape data without code.
- [Set Variable](./set-var.md): save a value without code.
- [If Condition](./if-condition.md): branch on the result.
- [HTTP Request](./http-request.md): call an API without code.
