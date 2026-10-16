---
title: Recipe - plan and work through a big job
description: Step by step tool calls that suggest plan mode for a big request, write the plan, then work through it with a todo list (update_todos) until every task is done.
---

# Recipe - plan and work through a big job

Goal: for a request that is more than a small change, agree on a plan with the user first, then work through it one task at a time with a todo list, so nothing is forgotten, even in a long chat that gets summarized.

## 1. Decide whether the request needs a plan

Suggest plan mode before you change anything when the request:

- touches several canvases or resources (routes, workflows, custom blocks, test suites, app config, ...),
- spans more than one area (for example a route, its trigger and a database integration), or
- is vague: you would have to guess what the user wants.

Do not suggest it for one or two small, clear changes (one new route, one fixed block, one renamed field). Just do those.

Call `suggest_plan_mode`:

```json
{ "reason": "Three new routes, a KV store and test suites: worth agreeing on a plan first." }
```

The call always waits for the user, in every mode. The result says what they chose:

| Result | What to do |
| --- | --- |
| `User switched to plan mode: look around with read tools and write the plan now. ...` | You are now in plan mode. Go to step 2 in the same reply. |
| `User chose to continue without a plan. Go on with the task.` | Do the work as usual, without a todo list. |
| `The user did not approve suggest_plan_mode ...` | Ask the user what they want, or continue without a plan. |

In plan mode `suggest_plan_mode` is not offered: you are already planning.

## 2. Write the plan (plan mode)

In plan mode you only have read tools. Use `list`, `get`, `get_canvas` and `search_docs` to see what exists, then reply with the plan as text:

- A numbered list of **main tasks**. Give a task **subtasks** when it has more than one step.
- Every task that changes something ends with a **check** subtask: `call_route`, or a test suite you write and run.
- "Commit" or "save a version" means Fluxify versioning (`commit_version`), not git.
- When the work will be ready for production, add a last task **"Ask the user about promoting to production"**. Never promote on your own.
- End the plan by telling the user how to start, word for word or close to it: *Reply "go ahead" to start. Switch to Auto first if you don't want to approve each change.*

To change the plan, the user replies in plan mode; write the whole plan again with the change.

## 3. After approval: write the todo list

The user approves the plan by switching to Manual or Auto and replying "go ahead". `update_todos` is offered from then on. Your first call writes the plan as the list.

Call `update_todos` with `items`:

```json
{
  "items": [
    {
      "text": "Build GET /products",
      "subtasks": [
        { "text": "save_route GET /products" },
        { "text": "edit_canvas: read products from the KV store, respond 200" },
        { "text": "Check with call_route" }
      ]
    },
    {
      "text": "Cover it with a test suite",
      "subtasks": [{ "text": "save_test_suite with a 200 case" }, { "text": "run_test_suite until it passes" }]
    },
    { "text": "Save a version of GET /products" },
    { "text": "Ask the user about promoting to production" }
  ]
}
```

Every call answers with the whole list and the task to do next:

```json
{
  "todos": [
    {
      "id": "1",
      "text": "Build GET /products",
      "status": "pending",
      "subtasks": [
        { "id": "1.1", "text": "save_route GET /products", "status": "pending" },
        { "id": "1.2", "text": "edit_canvas: read products from the KV store, respond 200", "status": "pending" },
        { "id": "1.3", "text": "Check with call_route", "status": "pending" }
      ]
    },
    {
      "id": "2",
      "text": "Cover it with a test suite",
      "status": "pending",
      "subtasks": [
        { "id": "2.1", "text": "save_test_suite with a 200 case", "status": "pending" },
        { "id": "2.2", "text": "run_test_suite until it passes", "status": "pending" }
      ]
    },
    { "id": "3", "text": "Save a version of GET /products", "status": "pending" },
    { "id": "4", "text": "Ask the user about promoting to production", "status": "pending" }
  ],
  "next": { "id": "1.1", "text": "save_route GET /products", "status": "pending" }
}
```

| Rule | Value |
| --- | --- |
| Ids | Given by position: `1`, `2`, ... for main tasks, `1.1`, `1.2`, ... for subtasks |
| Depth | One level of subtasks |
| Size | At most 30 items in all, 200 characters each |
| Statuses | `pending`, `in_progress`, `done`, `dropped` |
| In progress | One item at a time |
| A main task with subtasks | Its status comes from its subtasks: done when they are all done or dropped |

A call that breaks a rule fails with the reason, and the list stays as it was.

## 4. Work one task at a time

Start the item `next` names, then mark it. Call `update_todos` with `id` and `status`:

```json
{ "id": "1.1", "status": "in_progress" }
```

Do the work (here `save_route`), then:

```json
{ "id": "1.1", "status": "done" }
```

Read `next` from the result and go on: `1.2`, then `1.3`. Mark an item done only when its check passed. Mark one `dropped` when it is no longer needed. A main task with subtasks can only be marked `dropped` (that drops its open subtasks); otherwise mark its subtasks.

## 5. Change the list mid-way

When the user stops you and adds or drops work, write the whole list again with `items`, keeping the statuses of what is already done:

```json
{
  "items": [
    { "text": "Build GET /products", "status": "done", "subtasks": [{ "text": "save_route GET /products", "status": "done" }, { "text": "edit_canvas: read products from the KV store, respond 200", "status": "done" }, { "text": "Check with call_route", "status": "done" }] },
    { "text": "Add a ?category= filter to GET /products" },
    { "text": "Cover it with a test suite" },
    { "text": "Save a version of GET /products" },
    { "text": "Ask the user about promoting to production" }
  ]
}
```

Ids follow the new positions, so read them from the result.

## 6. Finish

When every item is `done` or `dropped`, the list is finished and `update_todos` is no longer offered. `{ "items": [] }` clears the list the same way. End with a short summary of what you changed and how you checked it. For the promotion task, ask the user; do not call `promote_version` unless they say so.

## After a summary

In a long chat the earlier part is replaced by a summary. The summary ends with the current todo list, and the latest `update_todos` result is never shortened. Carry on from the item in progress, or the first pending one, as if nothing happened.

## Common problems

| What you see | What to do |
| --- | --- |
| `update_todos works only after the user approves a plan.` | There is no approved plan and no open list. Work without one, or suggest plan mode. |
| `Only one item can be in_progress at a time` | Mark the finished item done first. |
| `Task 2 has subtasks: mark those instead.` | Mark the subtasks; the main task follows them. |
| `The list has 31 items` | Merge small steps into one subtask; keep it to 30. |
| `You are in plan mode already: write the plan.` | Don't suggest plan mode in plan mode. Write the plan. |
