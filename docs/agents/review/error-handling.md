---
title: Review recipe - error handling
description: Error handling checks for a route or workflow canvas, covering uncaught failures, unconnected failure paths, raw errors sent to callers and unbounded retries.
---

# Review recipe - error handling

Category: `error_handling`. These problems stay hidden until something fails: a slow database, an API that answers 500, a bad row. Then the caller gets a raw error, or a workflow stops halfway.

How failures move in a canvas: a block that fails (a refused connection, a bad query, an HTTP error status, a thrown JS error) skips its **Next** path. The run jumps to the canvas's **Error Handler** if there is one. Without one, a route answers `500` with `{ "error": "<message>" }`, and a workflow run fails. Retry and DB Transaction have their own **Failure** handle. An empty result is not a failure.

## No Error Handler on a canvas that calls out

- **Look for:** a canvas with database, HTTP, KV, AI, queue or JS Runner blocks and no Error Handler.
- **Severity:** `warning`. Make it `error` when the route returns data to an outside caller, since the raw error text reaches them.
- **Fix:** add an Error Handler that leads to a Response with a fitting status (500, 502 or 503) and a clean message. Log the error first if it matters.

## Raw error text sent to the caller

- **Look for:** an Error Handler path whose Response returns `input` (the error message) as it is, or an Error Handler path with no Response at all.
- **Severity:** `warning`.
- **Fix:** return a fixed message and log the real error with Console Log or Cloud Logs.

## Error Handler path that can fail too

- **Look for:** an Error Handler path with DB or HTTP calls, or long JS. A failure there ends the run with a bare 500.
- **Severity:** `warning`.
- **Fix:** keep the error path short: log, then answer.

## Retry or Transaction Failure left unconnected, with no Error Handler

- **Look for:** a Retry or DB Transaction whose **Failure** handle is unconnected, on a canvas with no Error Handler.
- **Severity:** `warning`.
- **Fix:** connect **Failure** to a Response or to compensating steps, or add an Error Handler.

## Retry with no limit or no delay

- **Look for:** a Retry with a very high attempt count, no backoff, or wrapped around a call that cannot succeed on a second try (a 400 or a validation failure).
- **Severity:** `warning`.
- **Fix:** limit attempts to a few, add exponential backoff, and retry only calls that fail for a while (timeouts, 5xx).

## Expected "no" answers treated as errors

- **Look for:** "not found" or "not allowed" cases left to the Error Handler (for example, JS that throws when a row is missing), so the caller gets a 500 instead of a 404 or 403.
- **Severity:** `warning`.
- **Fix:** branch with If Condition or DB Row Exists, and answer 404 or 403 on the Failure path.

## Missing results not checked

- **Look for:** a DB Get Single, KV get or HTTP result used by the next blocks (`input.id`, `input.email`) with no check that it exists.
- **Severity:** `warning`.
- **Fix:** check it with If Condition or DB Row Exists before use.

## JS Runner that hides failures

- **Look for:** `try { ... } catch {}` or `catch (e) { return null }` in JS code, which turns a real failure into an empty value that later blocks act on.
- **Severity:** `warning`.
- **Fix:** let it throw so the Error Handler runs, or return an explicit error shape and branch on it.

## Workflow step failure with no recovery

- **Look for:** a workflow whose later steps depend on an earlier write or call, with no Error Handler, no Retry around the flaky step and no compensation when it fails halfway.
- **Severity:** `warning`.
- **Fix:** wrap flaky calls in Retry, and add an Error Handler that logs the failure and undoes or flags partial work.
