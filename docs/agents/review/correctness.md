---
title: Review recipe - correctness
description: Correctness checks for a route or workflow canvas, covering branches with no response, unreachable blocks, wrong conditions and values read before they are set.
---

# Review recipe - correctness

Category: `correctness`. The canvas runs, but does the wrong thing.

## A branch that never answers

- **Look for:** in a route, an If Condition, Switch or loop path that ends without a Response block.
- **Severity:** `error`.
- **Fix:** end every path with a Response, with the right status.

## Unreachable or dead blocks

- **Look for:** blocks with no incoming edge from the entrypoint (other than the Error Handler), or a Switch case or If branch that can never match.
- **Severity:** `warning`. `info` for a stray unused block.
- **Fix:** connect or delete them.

## Wrong or inverted conditions

- **Look for:** If Condition or Switch logic that contradicts the block names or the flow (checks "not exists" on the "found" path), a comparison against the wrong type (a string query param against a number), or conditions that are always true or always false.
- **Severity:** `error` when it sends real requests down the wrong path.
- **Fix:** correct the condition. Convert query and header values first, since they are always strings.

## Value read before it is set

- **Look for:** `js:` code or Get Var that reads a variable or field that no earlier block on that path sets, or that only a different branch sets.
- **Severity:** `error`.
- **Fix:** set it with Set Var before the read on every path, or read it from `input`.

## `input` mistaken for something else

- **Look for:** code that treats `input` as the request body when the previous block is a DB, HTTP or JS block (`input` is the previous block's output), or that reads a field the previous block does not return.
- **Severity:** `error`.
- **Fix:** read the body with Get HTTP Request Body, or save values to variables early and read them later.

## Wrong status codes

- **Look for:** a 200 on an error or not-found path, a 500 for bad input, a missing 201 on create, or a redirect with no Location header.
- **Severity:** `warning`.
- **Fix:** 400 for bad input, 401 or 403 for auth, 404 for missing, 409 for conflicts, 201 for creates.

## Loops that never end or whose result is lost

- **Look for:** a For Loop with a bound taken from request input and no cap, or a loop body whose result is never used after the loop.
- **Severity:** `warning`.
- **Fix:** cap the bound, and use the loop's output.
