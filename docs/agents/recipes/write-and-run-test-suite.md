---
title: Recipe - write and run a test suite
description: Step by step tool calls that save a test suite for a route and a workflow, run it, read the result and trace a failure to its block.
---

# Recipe - write and run a test suite

Goal: a suite for `GET /users/:id` that checks the status, a body field and the speed, then a suite for a workflow with several cases. Fields and rules are in the [Test suite reference](/agents/test-suite).

A run is real. The route runs, so it can write data and call other services. Point risky suites at a test database with `integrationOverrides`, or skip the risky block with a hook.

## 1. Learn what the route expects

Call `get_route`:

```json
{ "routeId": "<route id>" }
```

Note the `path` and its `:params`, and the schemas. The suite must give a value for each `:param` in `routeParams`, and a body or query that passes the schemas. The route does not need to be active to be tested.

## 2. Save the suite

Call `save_test_suite`:

```json
{
  "targetType": "route",
  "targetId": "<route id>",
  "name": "Known user",
  "description": "User 42 exists and comes back with a name",
  "routeParams": { "id": "42" },
  "headers": { "Accept": "application/json" },
  "assertions": [
    { "target": "status", "operator": "eq", "expectedValue": "200" },
    { "target": "body", "propertyPath": "name", "operator": "exists" },
    { "target": "header", "propertyPath": "content-type", "operator": "contains", "expectedValue": "application/json" },
    { "target": "time", "operator": "lt", "expectedValue": "1000" }
  ]
}
```

It answers `{ "id": "<suite id>" }`. Every value in `expectedValue` is a string.

## 3. Run it

Call `run_test_suite`:

```json
{ "testSuiteId": "<suite id>" }
```

It waits about 10 seconds. A finished run looks like this:

```json
{
  "runId": "<run id>",
  "status": "failed",
  "passedCount": 0,
  "failedCount": 1,
  "suites": [
    {
      "testSuiteId": "<suite id>",
      "status": "failed",
      "cases": [
        { "name": "request", "status": "failed", "statusCode": 500,
          "failedChecks": ["Expected Status to eq 200, got: 500"],
          "traceRunId": "<recording id>" }
      ]
    }
  ]
}
```

If you get `status: "running"` and a `runId`, wait a moment and call `get_test_runs`:

Call `get_test_runs`:

```json
{ "testSuiteId": "<suite id>", "limit": 1 }
```

## 4. Find the block that failed

Every test run is recorded. Read the case's `traceRunId` with `get_recording`. `kind` and `targetId` are the suite's route.

Call `get_recording`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "runId": "<traceRunId>" }
```

The first span with `outcome: "failure"` names the block and the error. Read its input and output with `spanSeq`. The fix steps are in [Recipe, debug a failing route](/agents/recipes/debug-route-with-recording). Run the suite again after the fix.

## 5. Add more checks with custom JS

Use `customJs` when a simple check is not enough. Each `t.expect` is its own line in the result. The update replaces the list, so send every assertion you want to keep.

Call `save_test_suite`:

```json
{
  "testSuiteId": "<suite id>",
  "assertions": [
    { "target": "status", "operator": "eq", "expectedValue": "200" },
    { "target": "customJs",
      "customJs": "t.expect(fluxify.response.body.roles, 'roles').toContain('member');\nt.expect(fluxify.response.body).not.toHaveProperty('password');" }
  ]
}
```

## 6. Test a path without the real database

Skip the database block with a hook and give it made-up data. First get the block id:

Call `get_canvas`:

```json
{ "target": { "kind": "route", "id": "<route id>" } }
```

Call `save_test_suite`:

```json
{
  "targetType": "route",
  "targetId": "<route id>",
  "name": "Unknown user",
  "routeParams": { "id": "999" },
  "hooks": [
    { "blockId": "<db block id>", "onBefore": { "kind": "json", "value": "null" } }
  ],
  "assertions": [{ "target": "status", "operator": "eq", "expectedValue": "404" }]
}
```

The block is skipped and `null` flows on, as if no row was found. The block shows as `mocked` in the recording. A block with two paths takes a script: `t.skip(null, "failure")`.

## 7. A suite for a workflow

Call `save_test_suite`:

```json
{
  "targetType": "workflow",
  "targetId": "<workflow id>",
  "name": "Order cases",
  "input": {
    "source": "raw",
    "mode": "cases",
    "raw": [
      { "name": "paid", "input": { "orderId": 1, "status": "paid" } },
      { "name": "refunded", "input": { "orderId": 2, "status": "refunded" } }
    ]
  },
  "assertions": [
    { "target": "successful", "operator": "true" },
    { "target": "output", "propertyPath": "orderId", "operator": "exists" }
  ]
}
```

The workflow runs once for each case, with the same assertions. Run it with `run_test_suite`. The result has one case for each input case, with its own `traceRunId`.

## 8. Keep data clean

If the route writes rows, use setup and teardown:

1. `save_custom_block` with `usage: "test"`, then write its code with `edit_canvas` on `kind: "custom_block"`. Read `testsuite.runId` to make unique test data.
2. `save_test_suite` with `setupBlockId` and `teardownBlockId`. The setup result is `t.setup` in hooks and custom checks, and `testsuite.setup` in teardown.
3. Set `runAlone: true` if the suite changes data that other suites read.

To send the suite at a test database, add an `integrationOverrides` entry `{ "existingId": "<main db integration id>", "newId": "<test db integration id>" }`.

## 9. Keep or remove

A suite that guards a behaviour stays. Throwaway suites go:

Call `delete_test_suite`:

```json
{ "testSuiteId": "<suite id>" }
```

To reuse a suite on a similar route, `clone_test_suite` with `testSuiteId`, `kind` and `targetId`. Check `droppedHooks` in the answer.

## Common problems

| What you see | What to do |
| --- | --- |
| A 400 in the case | The request failed the route's schemas. Fill every `:param` in `routeParams` and match `bodySchema` and `querySchema`. |
| `Custom JS made no t.expect(...) checks` | The code needs at least one `t.expect`. Returning true does nothing. |
| A body check fails on an object | `eq` compares compact JSON text. Point `propertyPath` at one value, or use `toEqual` in custom JS. |
| `status: "running"` | The run took over 10 seconds. Call `get_test_runs`. |
| A case ends with `timeout` | The route or workflow ran past its `timeoutSeconds`, or a setup block ran past `setupTimeoutMs`. |
| `Setup, teardown and loader blocks must be test-only custom blocks of this project` | The block's `usage` is not `test`. `usage` cannot change, so create a new block. |
