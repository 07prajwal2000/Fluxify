---
title: Test suite reference for agents
description: Fields, assertions, hooks, limits, errors and JSON examples for route and workflow test suites saved with save_test_suite and run with run_test_suite.
---

# Test suite reference for agents

A test suite is a saved request (for a route) or a saved input (for a workflow), plus assertions that decide pass or fail. `save_test_suite` writes it and `run_test_suite` runs it. For background, see [Testing](/testing/).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_test_suites` | viewer | Suites of one route or workflow: id, name, description. Args: `targetType`, `targetId`. |
| `get_test_suite` | viewer | One suite in full. A body over 2000 characters is replaced by a note. |
| `save_test_suite` | creator | Create or update a suite. |
| `delete_test_suite` | creator | Deletes the suite and its hooks. The route or workflow stays. |
| `clone_test_suite` | creator | Copies a suite to another route or workflow of the project. |
| `run_test_suite` | creator | Runs one suite for real and returns the result. |
| `get_test_runs` | creator | Recent runs of one suite, newest first. |

A run is real. Setup, requests, workflow runs and teardown all happen. They can write data and call other services.

## Create a route suite

Pass `targetType: "route"`, `targetId` and `name`. Add the request and assertions in the same call.

```json
{
  "targetType": "route",
  "targetId": "<route id>",
  "name": "Get user 42",
  "routeParams": { "id": "42" },
  "queryParams": { "expand": "roles" },
  "headers": { "Authorization": "Bearer <token>" },
  "assertions": [
    { "target": "status", "operator": "eq", "expectedValue": "200" },
    { "target": "body", "propertyPath": "user.name", "operator": "exists" },
    { "target": "time", "operator": "lt", "expectedValue": "500" }
  ]
}
```

The result is `{ "id": "<suite id>" }`. The route does not need to be active to be tested.

A POST with a JSON body:

```json
{
  "targetType": "route",
  "targetId": "<route id>",
  "name": "Create user",
  "body": { "email": "ada@example.com", "role": "member" },
  "assertions": [{ "target": "status", "operator": "eq", "expectedValue": "201" }]
}
```

## Create a workflow suite

Pass `targetType: "workflow"`, `targetId`, `name` and `input`.

```json
{
  "targetType": "workflow",
  "targetId": "<workflow id>",
  "name": "Orders",
  "input": { "source": "raw", "mode": "single", "raw": { "orderId": 42, "status": "paid" } },
  "assertions": [
    { "target": "successful", "operator": "true" },
    { "target": "output", "propertyPath": "total", "operator": "eq", "expectedValue": "42" }
  ]
}
```

A trigger is not used. The workflow runs directly with this input.

## Update a suite

Pass `testSuiteId` and only the fields that change. A suite cannot move to another target. Use `clone_test_suite`.

```json
{ "testSuiteId": "<suite id>", "assertions": [{ "target": "status", "operator": "eq", "expectedValue": "200" }] }
```

`assertions` and `hooks` replace the whole list. Send the full list.

Creating is two steps inside the tool. If the second step fails, the half-made suite is deleted and you get the error.

## Fields

| Field | Applies to | Rule | Default |
| --- | --- | --- | --- |
| `name` | both | At least 1 character. Required on create. | none |
| `description` | both | Text or null. | empty |
| `routeParams` | route | `{ "id": "42" }`. One entry for each `:param` of the path. Strings only. | `{}` |
| `queryParams` | route | Strings only. | `{}` |
| `headers` | route | Strings only. | `{}` |
| `contentType` | route | One of the route's content types, or null for JSON. | null (JSON) |
| `body` | route | See [Body](#body). | none |
| `input` | workflow | See [Workflow input](#workflow-input). | none |
| `assertions` | both | See [Assertions](#assertions). All must pass. | `[]` |
| `hooks` | both | See [Hooks](#hooks). | none |
| `setupBlockId` | both | A `test` custom block run before. | none |
| `teardownBlockId` | both | A `test` custom block run after. | none |
| `setupTimeoutMs`, `teardownTimeoutMs` | both | 1000 to 600000. | `30000` |
| `runAlone` | both | Run this suite by itself, after the parallel ones. Use it for suites that change shared data. | `false` |
| `appConfigOverrides` | both | `[{ "key": "...", "value": "..." }]`. See [Overrides](#overrides). | `[]` |
| `integrationOverrides` | both | `[{ "existingId": "...", "newId": "..." }]`. | `[]` |

A suite with no assertions passes if the route or workflow runs without crashing.

## Body

| `contentType` | `body` is |
| --- | --- |
| null or `application/json` | Any JSON value. |
| `application/x-www-form-urlencoded` | An object of field to string. |
| `multipart/form-data` | An object of field to string. A file is `{ "name": "a.png", "type": "image/png", "base64": "..." }`. Several files are a list of those. |
| `application/octet-stream` | Base64 text. |
| `text/plain` | Text. |

The body is limited to about 1 MB. Past that: `Body is too large. Keep files under 1MB.`

## Workflow input

`input` is `{ source, mode, raw, script, loaderBlockId, timeoutMs }`.

| Field | Rule |
| --- | --- |
| `source` | `raw`, `script` or `loader`. |
| `mode` | `single` or `cases`. |
| `raw` | With `source: "raw"`. The value typed in. |
| `script` | With `source: "script"`. JavaScript that **returns** the value. It can import the project's npm packages. |
| `loaderBlockId` | With `source: "loader"`. A `test` custom block whose output is the value. |
| `timeoutMs` | 1000 to 600000. The time limit of the script or loader. |

The whole `input` is limited to about 1 MB.

A trigger always hands a workflow a **list of items**. The suite does the same.

| `raw` | Items | `input` in the workflow |
| --- | --- | --- |
| `{ "id": 1 }` | 1 | `{ "id": 1 }` |
| `[{ "id": 1 }]` | 1 | `{ "id": 1 }` |
| `[{ "id": 1 }, { "id": 2 }]` | 2 | `[{ "id": 1 }, { "id": 2 }]` |
| `[["a", "b"]]` | 1 | `["a", "b"]` |
| empty or `null` | 1 | `null` |

`trigger.data` is always a list.

### Cases

`mode: "cases"` runs the workflow once for each entry of `raw`, one after another, with the same assertions. The suite passes only when every case passes. At most **100** cases.

```json
{
  "source": "raw",
  "mode": "cases",
  "raw": [
    { "name": "paid order", "input": { "id": 1, "status": "paid" } },
    { "name": "bulk of two", "input": [{ "id": 2 }, { "id": 3 }] },
    { "id": 4 }
  ]
}
```

An entry with an `input` field is a case: `{ name, input }`, and `name` is optional. Any other entry is the input itself, named `Case 3` and so on. `[1, 2, 3]` in `single` mode is one run with three items. In `cases` mode it is three runs with one item each. If your own item has a field named `input`, wrap it: `{ "input": { "input": "x" } }`.

Errors, both on `input.raw`: `Cases must be a list; switch to Single input to send one value` and `Too many cases: 120 (the limit is 100)`.

## Assertions

Each assertion is `{ target, operator, expectedValue, propertyPath }`. All must pass. `customJs` replaces `operator` and `expectedValue` with `customJs`.

| `target` | For | Reads | Operators |
| --- | --- | --- | --- |
| `status` | route | The HTTP status | `eq`, `neq`, `lt`, `gt` |
| `time` | both | Duration in milliseconds | `eq`, `neq`, `lt`, `gt` |
| `body` | route | The response body | `eq`, `neq`, `contains`, `true`, `false`, `exists`, `not_exists` |
| `header` | route | One response header. `propertyPath` is the header name, not case-sensitive. | same as `body` |
| `successful` | workflow | Whether the run succeeded | `true`, `false` |
| `output` | workflow | The run's output | same as `body` |
| `customJs` | both | Your own checks | none |

- `expectedValue` is always a **string**: `"200"`, not `200`. It is not needed for `true`, `false`, `exists` and `not_exists`.
- `propertyPath` is only for `body`, `output` and `header`. It is a path such as `user.tags[0]`. Empty means the whole body.
- `eq` compares `status` and `time` as numbers. For everything else it compares as text. An object or list becomes compact JSON with no spaces, so prefer a `propertyPath` that points at one value.
- `contains` looks for the text inside the value. For an object it looks inside its JSON.
- `exists` is true when the value is present and not null.

### Custom JS

```json
{
  "target": "customJs",
  "customJs": "t.expect(fluxify.response.status, 'status').toBe(201);\nt.expect(fluxify.response.body.user.email).toContain('@');\nt.expect(fluxify.response.body.items).toHaveLength(3);"
}
```

It needs at least one `t.expect`, or it fails with `Custom JS made no t.expect(...) checks`. The return value is ignored. A failed check does not stop the code. A throw fails the assertion.

| Name | For | What it is |
| --- | --- | --- |
| `fluxify.response.status`, `.body`, `.headers` | route | The response. Header names are lower case. |
| `fluxify.request.path`, `.params`, `.query`, `.headers`, `.body` | route | The request that was sent. |
| `fluxify.input` | workflow | The input of the case. |
| `fluxify.result.successful`, `.output`, `.error` | workflow | How the run ended. |
| `t.setup` | both | What the setup block returned. |
| `t.case` | workflow | The case: `index`, `name`, `input`. |
| `t.zod` | both | The zod library, to check a shape. |

`t.expect(value, label?)` has these checks: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toContain`, `toHaveLength`, `toHaveProperty(path, value?)`, `toMatch`, `toBeGreaterThan`, `toBeLessThan`. Put `.not` in front to flip one: `t.expect(x).not.toBe(500)`. Use `toBe` for single values and `toEqual` for objects and lists.

## Setup and teardown

`setupBlockId` and `teardownBlockId` name custom blocks with `usage: "test"` from the same project. See [Custom block reference](/agents/custom-block). Setup runs before the request. Its result is `t.setup` in hooks and custom assertions, and `testsuite.setup` in the teardown block. Teardown runs after the checks.

Inside a test block you can read `testsuite.phase` (`setup`, `teardown`, or `input` for a workflow loader), `testsuite.runId` (unique per run, use it in test data so parallel suites do not clash), `testsuite.suite` (id and name), and in teardown `testsuite.outcome` (`passed`, `failed`, `error` or `timeout`).

## Hooks

A hook changes one block of the target's canvas during the test only. `hooks` is a list. It replaces all of the suite's hooks.

```json
{
  "testSuiteId": "<suite id>",
  "hooks": [
    { "blockId": "db_getsingle_1", "onBefore": { "kind": "json", "value": "{\"id\":7,\"name\":\"Test user\"}" } },
    { "blockId": "jsrunner_1", "onAfter": { "kind": "script", "value": "t.expect(output).toHaveLength(2);\nreturn [];" } }
  ]
}
```

A hook body is `{ "kind": "json" | "script", "value": "<text>" }`. For `json`, `value` is JSON text and must parse (`Invalid JSON` otherwise).

| Hook | What it does |
| --- | --- |
| `onBefore` script | Runs just before the block with `input` and `t`. Return nothing to run as normal. Return a value to use it as the block's input. `t.skip(output, branch?)` skips the block and passes `output` on. `branch` is `success` or `failure` for blocks with two paths. `t.fail("message")` or a throw fails the block. |
| `onBefore` json | Skips the block and passes that JSON on as its output. |
| `onAfter` script | Runs just after with `input`, `output` and `t`. Return nothing to keep the output. Return a value to replace it. It does not run when `onBefore` skipped the block. |
| `onAfter` json | Replaces the output with that JSON. |

`t` also has `t.call` (how many times this block has run, from 1), `t.vars`, `t.block`, `t.runId`, `t.setup`, `t.case`, `t.expect` and `t.zod`. Read earlier outputs with `t.vars.outputs.<name>`.

| Block | Allowed |
| --- | --- |
| `entrypoint`, `response`, `error_handler`, `sticky_note` | No hooks. |
| `if`, `switch`, `forloop`, `foreachloop`, `orchestrator`, `retry` | An `onBefore` script that changes the input. They cannot be skipped. |
| Every other block, custom blocks too | `onBefore` and `onAfter`, script or json. |

The block must be on the suite's own route or workflow. Each block has one entry. Name each block by its key from `get_canvas` (such as `db_getsingle_1`); a block id also works. `get_test_suite` shows the keys.

## Overrides

Overrides change what the suite uses, for this suite only. The real route, workflow and settings stay as they are.

```json
{
  "testSuiteId": "<suite id>",
  "appConfigOverrides": [{ "key": "PAYMENTS_API_URL", "value": "https://sandbox.example.com" }],
  "integrationOverrides": [{ "existingId": "<main db integration id>", "newId": "<test db integration id>" }]
}
```

- An app config override gives an existing key another value. An integration that reads that key through `cfg:` follows it. That is the simplest way to point a suite at a test database.
- An integration override swaps one integration for another of the same kind. Both must be in the project.
- A service with no override is really called. Use an override, or a hook that skips the block, for anything the test must not touch.

## Clone a suite

`clone_test_suite` takes `testSuiteId`, `kind` (`route` or `workflow`) and `targetId` of the same project. The copy is named `<name> (copy)`. Assertions, overrides, setup and teardown are copied. The request or input is copied only when `kind` is the same as the source.

Hooks move to the block with the same type and name on the target. The result is `{ "id": "...", "droppedHooks": ["<block name>"] }`. `droppedHooks` names the blocks that had no match.

## Run a suite

`run_test_suite` takes `testSuiteId`. It waits about 10 seconds. If the run finished, it returns the result.

```json
{
  "runId": "<run id>",
  "status": "failed",
  "passedCount": 0,
  "failedCount": 1,
  "durationMs": 182,
  "suites": [
    {
      "testSuiteId": "<suite id>",
      "status": "failed",
      "durationMs": 182,
      "cases": [
        {
          "name": "request",
          "status": "failed",
          "statusCode": 500,
          "failedChecks": ["Expected Status to eq 200, got: 500"],
          "traceRunId": "<recording id>"
        }
      ],
      "teardownError": null
    }
  ]
}
```

A route suite has one case, named `request`. A workflow suite has one case for each input case. A case `status` is `passed`, `failed`, `error` or `timeout`. `error` carries the message. Messages are cut at 500 characters.

If the run is not done in time, you get `{ "runId": "...", "status": "running", "message": "..." }`. Call `get_test_runs` with the suite id later. `limit` is 1 to 10, default 5.

Every test run is recorded, even when `recordExecution` is off. Read a case's recording with `get_recording`. Pass `kind` and `targetId` of the suite's route or workflow (from `get_test_suite`) and the case's `traceRunId` as `runId`. A hook-changed block is marked `mocked` in the spans. See [Recipe, write and run a test suite](/agents/recipes/write-and-run-test-suite).

## Common errors

| Message | Cause and fix |
| --- | --- |
| `To create a test suite pass targetType, targetId and name.` | One of the three is missing. |
| `Invalid input: assertions.0.operator: Operator is required` | An assertion other than `customJs` has no `operator`. The number is the assertion's position. |
| `Invalid input: assertions.0.operator: Operator 'lt' is not allowed for target 'body'` | See the operator table. |
| `Invalid input: assertions.0.expectedValue: Expected value is required` | Add `expectedValue` as a string. |
| `Invalid input: assertions.0.propertyPath: propertyPath must be absent or null unless target is 'body', 'output' or 'header'` | Remove `propertyPath`. |
| `Invalid input: input.raw: Input is too large (1MB max).` | Shorten `input`. Use a `script` or `loader` source for big data. |
| `Invalid input: hooks.0.onBefore.value: Invalid JSON` | A `json` hook value does not parse. |
| `Invalid input: Setup, teardown and loader blocks must be test-only custom blocks of this project` | The block is missing, from another project, or its `usage` is not `test`. |
| `Invalid input: Block X is not on this suite's route` | Use block keys from the target's canvas. |
| `Invalid input: A block can have only one hook entry` | Merge the two entries. |
| `Invalid input: A if block only allows an onBefore script that changes its input` | See the hook table. |
| `Not found: Test suite not found` | Wrong `testSuiteId`. Use `list_test_suites`. |
| `Custom JS made no t.expect(...) checks` | In a run result: add a `t.expect`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |
