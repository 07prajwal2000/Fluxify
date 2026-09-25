---
title: Testing Workflows
description: Run a workflow with test input, once or once per case, and check how it ends.
---

# Testing Workflows

A workflow can have test suites too. Instead of sending a request, a workflow suite gives the workflow some **input** and checks how the run ends.

Open a workflow, then choose the **Tests** tab next to **Canvas**. Everything works like a route's suites ([checks](./checks), [hooks](./hooks), [setup and teardown](./setup-and-teardown), [overrides](./overrides)), except that the **Request** tab is replaced by an **Input** tab.

::: info The trigger is skipped
A suite runs the workflow directly with the input you give it. The trigger (a queue, a schedule…) is not used and is not tested.
:::

## How a workflow receives data

A workflow is built to handle **one item or many items at once**. A trigger (a queue, a schedule…) always hands it a **list of items**, even when there is only one. A test suite does the same, so your workflow behaves in a test exactly like it does live.

Inside the workflow you can read the data in two ways:

| Name | What it holds |
| --- | --- |
| `input` | The easy way. **One item**: the item itself. **Several items**: a list of them. |
| `trigger.data` | Always a list, one entry per item: `[{ data: item1 }, { data: item2 }]`. |
| `trigger.meta.size` | How many items there are. |

So the value you type in the Input tab is **the list of items** the workflow gets.

## What you type, and what the workflow gets

| You type | Items | `input` in the workflow | `trigger.data` |
| --- | --- | --- | --- |
| `{ "id": 1 }` | 1 | `{ "id": 1 }` | `[{ data: { "id": 1 } }]` |
| `[{ "id": 1 }]` | 1 | `{ "id": 1 }` | `[{ data: { "id": 1 } }]` |
| `[{ "id": 1 }, { "id": 2 }]` | 2 | `[{ "id": 1 }, { "id": 2 }]` | `[{ data: { "id": 1 } }, { data: { "id": 2 } }]` |
| `[1, 2, 3]` | 3 | `[1, 2, 3]` | `[{ data: 1 }, { data: 2 }, { data: 3 }]` |
| `"hello"` or `42` or `true` | 1 | `"hello"` / `42` / `true` | `[{ data: "hello" }]` … |
| *(empty)* or `null` | 1 | `null` | `[{ data: null }]` |
| `[["a", "b"]]` | 1 | `["a", "b"]` | `[{ data: ["a", "b"] }]` |

The rules behind the table:

1. **A list is a list of items.** Each entry becomes one item.
2. **Anything that is not a list is one item.** `{ "id": 1 }` and `[{ "id": 1 }]` are the same thing.
3. **One item whose value is itself a list** needs a second pair of brackets: `[["a", "b"]]`. Without them, `["a", "b"]` would be two items.

::: tip `input` changes shape with the number of items
With one item, `input` is that item. With two or more, `input` is a list. If your workflow must handle both, read `trigger.data`, which is always a list.
:::

## Single input or cases

The switch at the top right of the Input tab decides **how many times** the workflow runs.

| Mode | The workflow runs | Your value is |
| --- | --- | --- |
| **Single input** | once | the items for that one run |
| **Cases** | once per case, one after another | a list of cases, each with its own items |

Every case gets the **same checks**. The suite passes only when every case passes.

::: warning Same value, different meaning
`[1, 2, 3]` in **Single input** is **one run with 3 items** (a bulk run).
`[1, 2, 3]` in **Cases** is **3 runs with 1 item each**.
:::

### Writing cases

In **Cases** mode, each entry of the list is one case. An entry can be written two ways:

| Entry | Case name | Items for that run |
| --- | --- | --- |
| `{ "name": "paid order", "input": { "id": 1 } }` | paid order | 1 item: `{ "id": 1 }` |
| `{ "input": [{ "id": 1 }, { "id": 2 }] }` | Case 2 (numbered for you) | 2 items (a bulk run) |
| `{ "id": 3 }` (no `input` field) | Case 3 | 1 item: `{ "id": 3 }` |
| `7` | Case 4 | 1 item: `7` |

An entry with an `input` field is read as `{ name, input }`. Anything else is used as the input itself. The same item rules as above apply to each case's input.

::: info Data that has its own `input` field
If your item really has a field called `input`, wrap it, or it will be read as a case: `{ "input": { "input": "my value" } }`.
:::

With **Raw data**, you don't write this list by hand: press **Add case**, give it a name, and type its input.

## Where the value comes from

| Source | What it is |
| --- | --- |
| **Raw data** | JSON you type in. |
| **Script** | JavaScript that **returns** the value. It works like a JS block, so your project's npm packages can be imported. It has 30 seconds to finish. |
| **Loader block** | A test-only custom block whose output is the value, for example rows read from a database. You choose its time limit. |

A script or loader runs **once**, after setup and before the workflow. What it returns follows the same rules as typed data: in **Single input** it is the items for the run, in **Cases** it must be a list of cases.

## Examples

### One item

Mode **Single input**, source **Raw data**:

```json
{ "orderId": 42, "status": "paid" }
```

The workflow runs once. `input.orderId` is `42`.

### A bulk run

Mode **Single input**, source **Raw data**:

```json
[
  { "orderId": 1, "status": "paid" },
  { "orderId": 2, "status": "refunded" }
]
```

The workflow runs once with 2 items. `input` is the list, `trigger.data.length` is `2`.

### The same rules for many shapes

Mode **Cases**, source **Raw data**. An "update order" workflow must succeed whether one field changes, several change, or an extra field shows up:

| Case name | Input |
| --- | --- |
| only status | `{ "id": 1, "status": "paid" }` |
| only address | `{ "id": 1, "address": { "city": "Pune" } }` |
| extra field | `{ "id": 1, "note": "ignored" }` |
| two at once | `[{ "id": 1, "status": "paid" }, { "id": 2, "status": "paid" }]` |

The workflow runs 4 times. The last case is a bulk run of 2 items.

### Cases where each case is a bulk run

Use this when you want to check how the workflow handles **several batches**, each with **several items**. The shape is a list of cases, and each case is a list of items:

```text
[
  [ case 1 item 1, case 1 item 2 ],   ← case 1: one run with 2 items
  [ case 2 item 1, case 2 item 2 ]    ← case 2: one run with 2 items
]
```

**With Raw data** (mode **Cases**): press **Add case** once per case, and type that case's items as a list in its input:

| Case name | Input |
| --- | --- |
| two paid orders | `[{ "id": 1, "status": "paid" }, { "id": 2, "status": "paid" }]` |
| paid and refunded | `[{ "id": 3, "status": "paid" }, { "id": 4, "status": "refunded" }]` |

This is saved as the following JSON (a script or loader can return the same shape):

```json
[
  {
    "name": "two paid orders",
    "input": [{ "id": 1, "status": "paid" }, { "id": 2, "status": "paid" }]
  },
  {
    "name": "paid and refunded",
    "input": [{ "id": 3, "status": "paid" }, { "id": 4, "status": "refunded" }]
  }
]
```

**With a Script** (mode **Cases**), return the same thing. Without names, a plain list of lists works too, and the cases are named Case 1, Case 2…:

```js
return [
  [{ id: 1, status: "paid" }, { id: 2, status: "paid" }],
  [{ id: 3, status: "paid" }, { id: 4, status: "refunded" }],
];
```

With names:

```js
return [
  { name: "two paid orders", input: [{ id: 1, status: "paid" }, { id: 2, status: "paid" }] },
  { name: "paid and refunded", input: [{ id: 3, status: "paid" }, { id: 4, status: "refunded" }] },
];
```

Or made up with faker: 5 cases, each a bulk run of 3 orders:

```js
import { faker } from "@faker-js/faker";

return Array.from({ length: 5 }, (_, c) => ({
  name: `batch ${c + 1}`,
  input: Array.from({ length: 3 }, () => ({
    id: faker.number.int(),
    status: faker.helpers.arrayElement(["paid", "refunded"]),
  })),
}));
```

What the workflow gets on each run:

| Run | `trigger.data` | `input` |
| --- | --- | --- |
| Case 1 | `[{ data: { id: 1, … } }, { data: { id: 2, … } }]` | `[{ id: 1, … }, { id: 2, … }]` |
| Case 2 | `[{ data: { id: 3, … } }, { data: { id: 4, … } }]` | `[{ id: 3, … }, { id: 4, … }]` |

::: warning Mode matters here too
The same `[[…], […]]` in **Single input** is **one run with 2 items**, and each item is itself a list. Pick **Cases** when you mean "one run per inner list".
:::

### Made-up data from a script

Mode **Cases**, source **Script** (add `@faker-js/faker` under the project's npm packages first):

```js
import { faker } from "@faker-js/faker";

// 10 cases, each one order
return Array.from({ length: 10 }, (_, i) => ({
  name: `order ${i + 1}`,
  input: { id: faker.number.int(), email: faker.internet.email() },
}));
```

Every case's input is saved with its result, so a failure can be looked at even though the data was random. Call `faker.seed(1)` first if you want the same data every run.

### A bulk run from a script

Mode **Single input**, source **Script**:

```js
return [{ id: 1 }, { id: 2 }, { id: 3 }];
```

The workflow runs once with 3 items.

## Limits

- Up to **100 cases** per suite. More is an error, not a silent cut.
- Typed data up to about **1 MB**.
- In **Cases** mode the value must be a list. Anything else fails the suite with "Cases must be a list".
- Each case gets the workflow's own time limit.
- Cases share the suite's setup and teardown, so data one case leaves behind can be seen by the next. Tick **Run alone**, or use a new suite, when a case needs a clean start.

::: tip Different results need different suites
Every case gets the same checks. If some inputs should **fail** and others **pass**, put them in separate suites.
:::

## Checks

A workflow run ends with a result: whether it **succeeded**, its **output** (what the last block returned), and an **error** if it failed.

| Check | What it looks at |
| --- | --- |
| **Run succeeded** | Whether the run ended without an error. |
| **Output** | The output, or a value inside it (for example `order.total`). |
| **Duration (ms)** | How long the run took. |
| **Custom JS** | Your own checks. `fluxify.input` is the case's input **as you typed it** (before it is turned into items), `fluxify.result` is `{ successful, output, error }`, and `t.case` is the case (`index`, `name`, `input`). |

A failed run does not stop the suite: it shows up as a failed check on that case, and the next case still runs.

## Results

The suite passes when every case passes. Open it in the results to see each case, failures first, with its checks, input and result. See [Reading results](./results).
