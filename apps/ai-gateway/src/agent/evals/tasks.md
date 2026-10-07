# Agent evals

Each task is a `## <n>. <title>` section. The text is the prompt. A `Setup:` line runs first as
its own agent run (to build what the task starts from). The `Check:` line is how a person grades
the saved conversation: pass only if the check holds in the project afterwards, not if the agent
merely says so.

Run against an empty test project: `bun run agent:evals --project <id>`.

## 1. Health route

Build GET /health that returns `{ "status": "ok" }`.

Check: the route is active and `call_route` returns 200 with that body; the agent called it itself.

## 2. Echo with a validated body

Build POST /echo. The body must have a required string `name`. Answer `{ "hello": <name> }`.

Check: a body with `name` gets 200 and the greeting; a body without it gets a 400. The agent tried both.

## 3. Path params

Build GET /users/:id that returns `{ "id": <id as a number>, "doubled": <id * 2> }`.

Check: `call_route` with id 21 returns `{ "id": 21, "doubled": 42 }`.

## 4. Workflow with a cron trigger

Add a workflow `nightly-report` that logs "report done", and a schedule trigger that starts it every day at 02:00.

Check: the workflow exists with a canvas that logs; an active schedule trigger points at it with a 02:00 daily schedule (six-field cron, seconds first).

## 5. Custom block used by a route

Create a custom block `slugify` with one text input `text` that returns the text lowercased with spaces turned into dashes. Then build GET /slug?text=... that uses it and returns `{ "slug": ... }`.

Check: `call_route` with text "Hello World" returns `{ "slug": "hello-world" }`.

## 6. Debug a broken route from its recording

Setup: Build GET /broken with recordExecution on. Its JavaScript block must return `items.length` without defining `items`. Activate it. Do not fix it.

The route GET /broken fails. Find out why from its recording and the system logs, fix it so it returns `{ "count": 0 }`, and prove it.

Check: the agent read `get_recording` or `get_system_logs` before editing, and `call_route` returns 200 with `{ "count": 0 }`.

## 7. Run the tests of a route

Find the test suites of GET /health, run them all and tell me which passed. If there are none, say so.

Check: the agent loaded `list_test_suites` with `load_tools` (or used `get`), and its answer matches what the project holds.

## 8. Edit a custom block

Change the custom block `slugify` so it also strips every character that is not a letter, digit or dash.

Check: GET /slug with text "Hi, There!" returns `{ "slug": "hi-there" }` (needs task 5 first).

## 9. App config value

Create a plaintext app config key `GREETING` with value "hello from config", then build GET /greeting that returns `{ "greeting": <that value> }` by reading the key, not a hard-coded string.

Check: `call_route` returns the value, and the canvas reads the app config key.

## 10. Project overview

What routes, workflows, triggers and custom blocks does this project have? One line each.

Check: one `list` call covered all four types, and the answer matches the project. No writes.
