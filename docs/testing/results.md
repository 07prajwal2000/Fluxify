---
title: Reading Results
description: What each test suite result means, how to find out why a suite failed, and how to fix common problems.
---

# Reading Results

Results appear in the panel on the right of the **Tests** tab.

- **Latest run** shows the run you just started. Each suite appears as soon as it finishes, so you don't wait for the slowest one.
- **Run history** lists earlier runs. Click one to see it again. **Clear** deletes the history (the suites stay).

## What each result means

| Result | Meaning |
| --- | --- |
| ✓ **passed** | The route ran and every check held |
| ✗ **failed** | The route ran, but at least one check did not hold |
| ✗ **error** | The suite could not finish: setup failed, the route crashed, or the request could not be sent |
| ⚠ **timeout** | Setup or the route took longer than its time limit and was stopped |

A run passes when all its suites pass.

## Why did it fail?

Click a suite's row to open it. You'll see:

- **Every check**, with a ✓ or ✗. A failed check says what it expected and what it got, for example `expected 500 to be 201`. Checks from [hooks](./hooks) come first, labelled with their block.
- **The error**, if the suite hit one (for example `Setup failed: duplicate email`).
- **The response** the route sent: status, headers and body, so you can compare them with what you expected.

A suite stopped for taking too long has no checks to show, because it never got that far.

## Teardown warnings

If a suite's [teardown](./setup-and-teardown) fails, the suite **keeps its result** and shows **⚠ Teardown failed** next to its name. Open it to see the reason. When the run finishes, a notice also tells you how many suites had this problem, because their test data may still be in the database.

## Common problems

| You see | What it means | What to do |
| --- | --- | --- |
| "No worker is serving this project's routes" | Suites run on the same servers as your live routes, and none is running for this project | Start a worker for the project, then run again |
| "No result from a worker within …" | The worker didn't answer in time, for example because it restarted mid-run | Run again. If it keeps happening, raise the suite's time limits |
| "Custom JS made no t.expect(...) checks" | A Custom JS check doesn't call `t.expect` | Rewrite it with `t.expect(...)`. See [Custom JS checks](./checks#custom-js-checks) |
| "Setup failed: …" | The setup block threw an error | Open the setup block and fix it. The route was skipped |
| "setup timed out" / "suite timed out" | A phase took longer than its limit | Raise the limit, or find what is slow (a hook, a slow service) |
| The request doesn't reach the route | A path value is missing, so the address doesn't match the route | Fill every **Path parameter** in the Request tab |
| A suite passes alone but fails with **Run all** | Suites running at the same time see each other's data | Make test data unique with `testsuite.runId`, or tick **Run alone**. See [Run alone](./setup-and-teardown#run-alone) |
