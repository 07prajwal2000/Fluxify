---
title: Review recipe - performance
description: Performance checks for a route or workflow canvas, covering calls inside loops, unbounded queries and repeated work.
---

# Review recipe - performance

Category: `performance`. Fine with ten rows, slow or down with ten thousand.

## A call inside a loop

- **Look for:** a DB, HTTP, KV or AI block inside a For Loop or For Each body, once per item.
- **Severity:** `warning`. `error` when the item count comes from request input with no cap.
- **Fix:** use one query with `IN` or a join, DB Insert Bulk for writes, or one batched API call.

## Unbounded query

- **Look for:** DB Get All or a DB Native `SELECT` with no limit or paging on a table that grows, often returned straight to the caller.
- **Severity:** `warning`.
- **Fix:** add a limit and paging. See [Paging and sorting](/blocks/db-paging-sorting).

## Repeated work

- **Look for:** the same query or call made more than once on one path, or work done for each item that gives the same result every time.
- **Severity:** `info`.
- **Fix:** do it once and save the result to a variable.

## Slow outside call with no timeout or cache

- **Look for:** an HTTP or AI call on a busy route with no timeout, or the same data fetched on every request when it rarely changes.
- **Severity:** `info`.
- **Fix:** set a timeout, and cache the result in KV with an expiry.

## Heavy work on a route

- **Look for:** a route that sends many messages, runs a long AI call or processes a large batch before answering.
- **Severity:** `info`.
- **Fix:** answer 202 and run the work in a workflow with Trigger Workflow.
