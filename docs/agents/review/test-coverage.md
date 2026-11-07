---
title: Review recipe - test coverage
description: Test coverage checks for a route or workflow, covering missing test suites and branches or error paths no test reaches.
---

# Review recipe - test coverage

Category: `test_coverage`. Compare the canvas's paths with its test suites.

## No test suites at all

- **Look for:** a route or workflow with no suites.
- **Severity:** `warning` when it writes data or has branches. `info` for a trivial read.
- **Fix:** add a suite with the main success case. See [Write and run a test suite](/agents/recipes/write-and-run-test-suite).

## Branches no test reaches

- **Look for:** If Condition, Switch or DB Row Exists paths (not found, not allowed, bad input) that no test input would take.
- **Severity:** `warning`.
- **Fix:** add a test per branch that asserts its status and body.

## Error paths never tested

- **Look for:** an Error Handler, a Retry or Transaction Failure path, or schema validation (400) with no test that triggers it.
- **Severity:** `info`.
- **Fix:** add a test with input the schema rejects, and one that makes a call fail.

## Tests that assert nothing useful

- **Look for:** tests that check only the status, or whose assertions would pass on a wrong body.
- **Severity:** `info`.
- **Fix:** assert the key fields of the body.
