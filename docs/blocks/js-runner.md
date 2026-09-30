---
title: JS Runner
description: Write your own JavaScript for anything the other blocks don't cover.
---

# JS Runner

The **JS Runner** block runs JavaScript that you write. It receives the data from the previous block as `input`, and whatever you `return` goes to the next block. It is the most flexible block, for logic that no other block covers.

## When to use it

- Do custom calculations or business rules, like prices, discounts or scoring.
- Combine several values, or reshape data in a way the [Transformer](./transformer.md) field map can't.
- Read request details, call an API with `httpClient`, verify a JWT, or use any npm package you installed.
- Don't use it when a dedicated block exists. [If Condition](./if-condition.md), [Set Variable](./set-var.md) and the [DB blocks](./db-get-all.md) are easier to read and show up clearly on the canvas.
- Don't use it to branch the flow. It has one **Next** handle. Compute the answer here and follow it with an [If Condition](./if-condition.md) or [Switch](./switch.md).

## Inputs

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| **Value** | Yes | none | The JavaScript code. Modern syntax works. |

::: tip Your code always runs async
The code runs inside an `async` function, so `await` works anywhere with no setup. `const res = await httpClient.get(url);` is fine. You don't need to mark anything `async` yourself.
:::

Available as plain names in your code:

| Name | What it is |
| --- | --- |
| `input` | The previous block's output. |
| `outputs` | Outputs saved with **Save output to variable** on other blocks, by name. |
| `trigger` | What started the run, and the events of a workflow run. |
| `getRouteParam(k)`, `getQueryParam(k)`, `getHeader(k)`, `getCookie(k)`, `getRequestBody()` | Read the request. In a workflow, `getRequestBody()` is the run's payload and the others return `""`. |
| `setHeader(k, v)`, `setCookie(name, options)` | Add to the response. |
| `getConfig(key)` | Read a value from [App Config](../concepts/app-config.md). |
| `httpClient` | Call other services. |
| `logger` | `logInfo`, `logWarn` and `logError`. |
| `jwt` | Sign, verify and decode tokens. The only library that is built in. |

There is no `dayjs`, `_` (Lodash) or `zod` built in. To use a library, install it under **Project Settings > npm Packages**, then `import` it at the top of your code, for example `import dayjs from "dayjs";`. See [Imports & Libraries](../scripting/imports.md).

Inside a [custom block](./custom-blocks.md) you also get `params`, the block's settings. The full list, with types, is in the [JavaScript API Reference](../scripting/javascript-api.md), and [Where Your Code Runs](../scripting/environments.md) shows which names exist where.

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
- **`await` always works.** Every script is an async function, so you can `await` calls anywhere in it.
- **No `require()`.** Use `import` at the top of the code. A package that is not installed stops the workflow from compiling, with an error naming it.
- **No time limit of its own.** Keep long waits short. The whole route or workflow has a time limit.
- **It replaces the flowing data** with what you return.

## Related blocks

- [Transformer](./transformer.md): reshape data without code.
- [Set Variable](./set-var.md): save a value without code.
- [If Condition](./if-condition.md): branch on the result.
- [HTTP Request](./http-request.md): call an API without code.
