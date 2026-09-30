---
title: Blocks Overview
description: Blocks are the building pieces of a Fluxify flow. Learn what they are, how the pages are organized, and which block to reach for.
---

# Blocks Overview

Blocks are the building pieces of every Fluxify route and workflow. Each block does one job, like reading a database row, checking a condition, or sending a response. You connect blocks on the canvas, and data flows from one to the next.

## Using a block

1. Drag a block from the sidebar onto the canvas.
2. Click it to set its fields in the side panel. The **Docs** tab there shows the page for that block.
3. Connect it to other blocks to decide what runs first, next, and on each path.

New to this? Read [How Blocks Work](./how-they-work.md) first. It explains inputs, outputs and how data moves from block to block.

## What you find on a block page

Every block page has the same parts, in the same order:

| Section | What it tells you |
| --- | --- |
| **Intro** | What the block does, in one or two plain sentences. |
| **When to use it** | Real situations for it, and when to pick another block. |
| **Inputs** | Every field, whether it is required, and its default. |
| **Outputs** | What the next block receives, and which handles the block has (like **Success** and **Failure**). |
| **Example** | A small realistic setup with the settings and the result. |
| **How it behaves** | Edge cases, errors and anything surprising. |
| **Related blocks** | Blocks that are often used together with it. |

## Which block do I need?

| I want to... | Use |
| --- | --- |
| Choose between two paths | [If Condition](./if-condition.md) |
| Choose between many paths | [Switch](./switch.md) |
| Repeat something | [For Loop](./for-loop.md) (a number of times) or [For Each Loop](./foreach-loop.md) (once per item) |
| Do several things at the same time | [Orchestrator](./orchestrator.md) |
| Send an answer to the caller | [Response](./response.md) |
| Handle a failure | [Error Handler](./error-handler.md) |
| Read what the caller sent | [Get HTTP Request Body](./get-http-request-body.md), [Get HTTP Param](./get-http-param.md), [Get HTTP Header](./get-http-header.md), [Get Request Cookie](./get-request-cookie.md) |
| Call another web service | [HTTP Request](./http-request.md) |
| Read or change data in a database | [DB Get All](./db-get-all.md), [DB Get Single](./db-get-single.md), [DB Insert](./db-insert.md), [DB Update](./db-update.md), [DB Delete](./db-delete.md) |
| Change several records together, or none | [DB Transaction](./db-transaction.md) |
| Remember a value for this request | [Set Variable](./set-var.md) and [Get Variable](./get-var.md) |
| Cache something between requests | [KV Operations](./kv-operations.md) |
| Reshape data | [Transformer](./transformer.md) |
| Write my own code | [JS Runner](./js-runner.md) |
| Run background work | [Trigger Workflow](./trigger-workflow.md) |
| Log what happened | [Console Log](./console-log.md) or [Cloud Logs](./cloud-logs.md) |

## Block groups

| Group | What it covers |
| --- | --- |
| **Logic & Flow** | Start the flow, choose paths, repeat, run in parallel, handle errors, and respond. |
| **Data** | Variables, lists, reshaping data, and your own JavaScript. |
| **HTTP** | Call other services, and read or set request details like headers and cookies. |
| **Database** | Read, write and group changes in SQL and MongoDB databases. |
| **Key-Value** | Cache and short-lived state in Redis or Memcached. |
| **Logging** | Print to the server logs or send to a log service. |
| **Utility** | Start workflows, and add notes to the canvas. |
| **Custom Blocks** | Turn a group of blocks into one reusable block. |

See the full [List of Blocks](./list-of-blocks.md) for every block in each group.
