---
title: List of Blocks
description: Every Fluxify block, grouped by what it does, with a one-line summary and a link to its page.
---

# List of Blocks

Every block available in Fluxify, grouped by what it does. New to blocks? Start with the [Blocks Overview](./index.md) and [How Blocks Work](./how-they-work.md).

## Logic & Flow
Start the flow, choose paths, repeat, run in parallel, handle errors, and respond.

- [**Entrypoint**](./entrypoint.md): where every flow starts.
- [**If Condition**](./if-condition.md): go one way when a check is true, another when it is false.
- [**Switch**](./switch.md): pick one of several paths. The first matching case wins.
- [**For Loop**](./for-loop.md): repeat a chain a set number of times.
- [**For Each Loop**](./foreach-loop.md): run a chain once for every item in a list.
- [**Orchestrator**](./orchestrator.md): run several chains at the same time and collect the results.
- [**Error Handler**](./error-handler.md): choose what happens when a block fails.
- [**Response**](./response.md): send the answer to the caller and end the flow.

## Data
Variables, lists, reshaping data, and your own JavaScript.

- [**Set Variable**](./set-var.md): save a value for later blocks in the same request.
- [**Get Variable**](./get-var.md): read a saved value back.
- [**Array Operations**](./array-operations.md): add to, remove from or filter a list in a variable.
- [**Transformer**](./transformer.md): reshape an object by renaming fields or with JavaScript.
- [**JS Runner**](./js-runner.md): write your own JavaScript.
  - [JS Runner examples](./js-runner-examples.md): ready-to-copy code.

## HTTP
Call other services, and read or set request details.

- [**HTTP Request**](./http-request.md): call an external API.
- [**Get HTTP Param**](./get-http-param.md): read a query or path value from the URL.
- [**Get HTTP Header**](./get-http-header.md): read a request header.
- [**Get HTTP Request Body**](./get-http-request-body.md): read the body the caller sent.
- [**Get Request Cookie**](./get-request-cookie.md): read a cookie from the request.
- [**Set HTTP Header**](./set-http-header.md): add a header to the response.
- [**Set HTTP Cookie**](./set-http-cookie.md): send a cookie with the response.

## Database
Read, write and group changes in SQL and MongoDB databases.

- [**DB Get All**](./db-get-all.md): fetch a list of records.
- [**DB Get Single**](./db-get-single.md): fetch one record.
- [**DB Row Exists**](./db-row-exists.md): branch on whether a record exists.
- [**DB Count**](./db-count.md): count the records that match.
- [**DB Insert**](./db-insert.md): add one record, or update it if it already exists.
- [**DB Insert Bulk**](./db-insert-bulk.md): add many records at once.
- [**DB Update**](./db-update.md): change existing records.
- [**DB Delete**](./db-delete.md): remove records.
- [**DB Transaction**](./db-transaction.md): make a group of changes succeed or fail together.
- [**Rollback Transaction**](./db-rollback.md): cancel the transaction and undo its changes.
- [**DB Native**](./db-native.md): run your own SQL from JavaScript.

Shared options used by several database blocks:

- [DB Conditions](./db-conditions.md): operators, groups, optional filters and custom conditions.
- [DB Joins](./db-joins.md): combine related tables.
- [DB Sorting and Paging](./db-paging-sorting.md): order records and read them page by page.

## Key-Value
Cache data and keep short-lived state.

- [**KV Operations**](./kv-operations.md): get, set or delete one key.
- [**KV Raw Connection**](./kv-raw.md): run any command against the store.

## Logging
See what your flows are doing.

- [**Console Log**](./console-log.md): print to the server logs.
- [**Cloud Logs**](./cloud-logs.md): send to a log service like Loki or OpenTelemetry.

## Utility
Helper blocks.

- [**Trigger Workflow**](./trigger-workflow.md): start a workflow now or later, and carry on.
- [**Sticky Note**](./sticky-note.md): add a note to the canvas.

## Custom Blocks
Build your own.

- [**Custom Blocks**](./custom-blocks.md): turn a group of blocks into one reusable block.
- [**Tutorial**](./custom-blocks-tutorial.md): build your first custom block step by step.
