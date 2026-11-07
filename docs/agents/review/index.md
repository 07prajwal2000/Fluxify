---
title: Review recipes
description: The categories a canvas review checks, with one recipe per category listing what to look for, how severe it is and how to fix it.
---

# Review recipes

A review of a route or workflow checks the canvas against these categories. Each category has a recipe: a list of checks, and for each check what to look for, how severe it is and how to fix it.

The AI review in the canvas follows these recipes. An agent fixing a review finding, or reviewing a canvas on its own, can search them with `search_docs` (for example "review error handling") and open one with `read_doc`.

## Categories

| Category | Recipe | Catches |
| --- | --- | --- |
| `security` | [Security](/agents/review/security) | Missing auth, unvalidated input, injection, secrets in blocks, data leaked in responses |
| `error_handling` | [Error handling](/agents/review/error-handling) | Failures that go uncaught, unconnected failure paths, raw errors sent to callers, retries with no end |
| `correctness` | [Correctness](/agents/review/correctness) | Branches that never answer, unreachable blocks, wrong conditions, values read before they are set |
| `data_integrity` | [Data integrity](/agents/review/data-integrity) | Writes with no transaction, updates or deletes with no filter, steps that are not safe to run twice |
| `schema` | [Schema](/agents/review/schema) | Request schemas that disagree with what the blocks read, inconsistent response shapes |
| `performance` | [Performance](/agents/review/performance) | Calls inside loops, unbounded queries, repeated work |
| `test_coverage` | [Test coverage](/agents/review/test-coverage) | No test suites, error paths and branches no test reaches |

## Severity

| Severity | Meaning |
| --- | --- |
| `error` | It will break, lose or corrupt data, or can be exploited. |
| `warning` | Likely wrong, or risky under ordinary conditions (a slow service, an empty table, a retry). |
| `info` | Worth knowing; not wrong today. |

## Rules for every review

- Report real problems only, each once, most severe first. No style nitpicks. An empty list is a fine answer.
- Name blocks by their canvas keys (`db_native_1`), not by type alone.
- App config and integration values are hidden on purpose. Do not report them as missing.
- When a problem fits two categories, use the one whose fix it needs. A missing Error Handler is `error_handling`, even if it also leaks a raw error.
