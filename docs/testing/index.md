---
title: Test Suites
description: Check that a route does what you expect, every time you change it, without calling it by hand.
---

# Test Suites

A **test suite** checks one route for you. It sends the route a request you describe, then checks the answer against rules you write. You can run it any time, for example after changing the route, to make sure nothing broke.

Think of it as a saved "try it out" call that also knows what the right answer looks like.

## What a suite can do

| You want to… | Use |
| --- | --- |
| Send the route a request (path values, query, headers, body) | [The request](./first-suite#_3-describe-the-request) |
| Check the status code, a header, a value in the body, or how long it took | [Simple checks](./checks#simple-checks) |
| Write your own checks in JavaScript | [Custom JS checks](./checks#custom-js-checks) |
| Stop a block from really running (for example, skip a database call) and give it a made-up result | [Hooks](./hooks) |
| Change what a block receives or returns, to test an unusual case | [Hooks](./hooks) |
| Add test data before the suite and remove it after | [Setup and teardown](./setup-and-teardown) |
| Point the route at a test database or use different settings | [Overrides](./overrides) |

## What happens when you press Run

Every suite runs through the same steps, in this order:

1. **Setup** (optional): a block you choose runs first, for example to add a test user.
2. **The request**: the route runs with the request you described. Any [hooks](./hooks) you added run inside it.
3. **Checks**: your checks look at the answer.
4. **Teardown** (optional): a block you choose runs last, for example to delete the test user. It runs even when checks fail.

Then the suite gets one result: **passed**, **failed**, **error**, or **timeout**. See [Reading results](./results).

::: tip Suites test what you saved
A suite always runs the route as it is **saved** on the canvas, not the version that is live. You can test a change before anyone uses it.
:::

::: info Suites never touch live traffic
Each suite runs on its own, away from the requests your users are sending. Changes a suite makes for testing, such as a made-up block result or a different database, only apply to that suite.
:::

## Where to find it

Open a route, then choose the **Tests** tab next to **Canvas**. On the left is the list of suites for that route, in the middle is the editor for the selected suite, and on the right are the results.

Next: [Create your first test suite](./first-suite).
