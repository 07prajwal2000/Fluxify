---
title: Docs for AI Agents
description: Facts and recipes written for AI agents that build in Fluxify through its tools, with no UI steps.
---

# Docs for AI Agents

This section is written for AI agents, not people. It is hidden from the docs menu, but it is listed in `llms.txt` and comes first in the agent's docs search.

Each page sticks to facts an agent needs to call the Fluxify tools correctly: fields, rules, limits, defaults, common errors and JSON examples. It never describes clicks or screens.

## How to read these pages

Search with `search_docs`, then open a page with `read_doc`. With no heading, `read_doc` lists the page's sections; pass one of them as the heading to read just that section.

## Resource pages

One page per thing you can save with the tools.

- [Route reference](/agents/route): an HTTP endpoint. Fields, path rules, request schemas, content types and errors for `save_route`.
- [Workflow reference](/agents/workflow): a background job. Fields, timeouts, what it receives and errors for `save_workflow`.
- [Trigger reference](/agents/trigger): what starts a workflow. Cron and interval schedules, queue sources, batching and errors for `save_trigger`.
- [Custom block reference](/agents/custom-block): a reusable block with your own code. Input parameters, usage kinds, writing the code and errors for `save_custom_block`.
- [Middleware reference](/agents/middleware): a chain of custom blocks run before or after routes. Run order and errors for `save_middleware`.
- [Integration reference](/agents/integration): a connection to a database, KV store, AI provider or queue. Config for every variant, `cfg:` secrets and errors for `save_integration`.
- [App config reference](/agents/app-config): project settings and secrets. Encryption, encoding and errors for `save_app_config`.
- [Test suite reference](/agents/test-suite): saved requests or inputs with assertions. Assertions, hooks, overrides, running and errors for `save_test_suite`.

## Block inputs

- [Dynamic values and `js:` expressions](/agents/expressions): how a block input becomes dynamic. The `js:` prefix, what names exist, which fields accept it and the common mistakes. Read it before you fill any block field.

## Recipes

Each recipe is a list of steps. Every step is a tool call with its arguments.

- [Route with JWT auth](/agents/recipes/route-jwt-auth): a route that answers 401 unless the request has a valid token.
- [Debug and fix a route or workflow](/agents/recipes/debug-and-fix): read the debug error from `call_route`, check the logs, record a run if needed, fix and re-run.
- [Workflow with a cron trigger](/agents/recipes/workflow-cron-trigger): a background job that runs on a schedule.
- [Write and run a test suite](/agents/recipes/write-and-run-test-suite): save a suite, run it, read the result, trace a failure.
- [Use an integration in a canvas](/agents/recipes/use-integration-in-canvas): a database integration with its secret, read from a route.

## Rules that apply to every tool

- Tools act as the signed-in user. A `You need the ... role` error means ask a project admin. Do not retry.
- A `save_*` tool creates when you leave out the resource id, and updates when you pass it. On update, send only the fields that change.
- A new route, workflow or trigger is inactive. Switch it on with `active: true` when it is ready.
- A block text input is a literal unless it starts with `js:`, and `js:` code must `return` the value. Never use `{{ }}`. See [Dynamic values and `js:` expressions](/agents/expressions).
- Put secrets in app config and refer to them as `cfg:KEY` in an integration, or with `getConfig("KEY")` in code. Never write a secret into a block or a canvas.
- Check `get_system_logs` after a change. Compile errors show up there.
