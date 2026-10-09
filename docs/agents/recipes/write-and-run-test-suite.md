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

A failed case's `error` often says it already: the `block` that failed, its `message` and the real cause in `detail`. For more, read the recording: every test run is recorded. Read the case's `traceRunId` with `get_recording`. `kind` and `targetId` are the suite's route.

Call `get_recording`:

```json
{ "projectId": "<project id>", "kind": "route", "targetId": "<route id>", "runId": "<traceRunId>" }
```

The first span with `outcome: "failure"` names the block and the error. Read its input and output with `spanSeq`. The fix steps are in [Recipe, debug and fix a route or workflow](/agents/recipes/debug-and-fix). Run the suite again after the fix.

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

Skip the database block with a hook and give it made-up data. First get the block key:

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
    { "blockId": "db_getsingle_1", "onBefore": { "kind": "json", "value": "null" } }
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

Teardown also reads `testsuite.request` and `testsuite.response`, so it can delete a row by the id the route returned. Step 9 does this end to end.

To send the suite at a test database, add an `integrationOverrides` entry `{ "existingId": "<main db integration id>", "newId": "<test db integration id>" }`.

## 9. A suite you can rerun against a real database

Goal: `POST /signup` (Row Exists on the email, **Success** answers `409`, **Failure** inserts the user and answers `201 { "id": 7, "email": "…" }`) tested against the real database, again and again, without a "duplicate email" failure or leftover rows.

Three parts: unique data, a mocked existence check for the duplicate case, and cleanup by the id the route returned.

**Unique data.** The request body is fixed when you save, but a hook can change what a block receives. Make the email from `t.runId`, which is new for every run of a suite. On the **Row Exists** block (key `db_exists_1`), an `onBefore` script:

```js
return { ...input, email: `${t.runId}@test.local` };
```

**Row Exists** sends its input on unchanged down **Failure**, so the insert after it uses the same email. In a workflow suite with `cases`, `t.runId` is the same for every case, so use `` `${t.runId}-${t.case.index}@test.local` ``.

**Mock the existence check.** To test the duplicate answer without any data, skip the check and say it found a row. `success` is the "found" path:

```js
t.skip({ id: 1, email: "taken@test.local" }, "success");
```

**Clean up.** Teardown reads the response, so it can delete the row the route created. Call `save_custom_block` with `usage: "test"` (`cleanup_users`), then `edit_canvas` on `kind: "custom_block"`: Entrypoint → JS Runner → Delete Record(s) (table `users`, condition `id` equals `js:input.id`). The JS Runner:

```js
// the route answered { id, email }; no row was made if it crashed or answered 409
const id = testsuite.response?.body?.id;
return { id: id ?? 0 };
```

`testsuite.response` is `null` when the route crashed or timed out, so read it with `?.`. Teardown runs after a failed suite as well.

Call `save_test_suite`:

```json
{
  "targetType": "route",
  "targetId": "<route id>",
  "name": "Signs up a new user",
  "body": { "email": "placeholder@test.local", "password": "s3cret-pass" },
  "teardownBlockId": "<cleanup_users id>",
  "hooks": [
    { "blockId": "db_exists_1", "onBefore": { "kind": "script", "value": "return { ...input, email: `${t.runId}@test.local` };" } }
  ],
  "assertions": [
    { "target": "status", "operator": "eq", "expectedValue": "201" },
    { "target": "body", "propertyPath": "id", "operator": "exists" }
  ]
}
```

A second suite, "Rejects a taken email", has the same body, a hook `{ "blockId": "db_exists_1", "onBefore": { "kind": "script", "value": "t.skip({ id: 1 }, \"success\");" } }`, no teardown, and `status` equals `409`.

Run both as often as you like. Before running, `validate_test_suite` checks that every body path in the assertions exists in the last response.

## 10. Keep or remove

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
