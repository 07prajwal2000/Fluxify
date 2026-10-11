---
title: Sandbox
description: A private scratch canvas you can call over HTTP with any method and body, or run as a workflow, on development data and always recorded.
---

# Sandbox

A **sandbox** is a scratch canvas of your own. Put any blocks on it and run them
against your development data, without touching a real route or workflow. Use
one to try a custom block, prototype an idea, or look at data with DB Native,
the KV blocks or the JS Runner.

| What | Detail |
| :--- | :--- |
| How many | As many as you like, per project. They never expire. |
| Who sees one | Only you. Nobody else in the project can see, open or run your sandboxes, not even an admin. |
| Who can make one | Creators and project admins. Viewers can't. |
| Where it runs | On a [development worker](/concepts/environments#what-a-development-worker-does), with your [development values](/concepts/environments#values-per-environment). Never on a production worker. |
| Recording | **Every run is recorded**, and you can't switch it off. |
| Tracing | Off by default. Turn it on in the sandbox's settings to send its spans to the project's telemetry destination. |

A sandbox canvas is like a route canvas and a workflow canvas at once. The same
blocks run whether you call it over HTTP or run it as a workflow.

## In the portal

Open **Sandboxes** in the project's sidebar. Creators and project admins see it;
viewers don't.

| Screen | What you do there |
| :--- | :--- |
| **List** | See your sandboxes. Create one by giving it a name, rename it, open it, or delete it. |
| **Canvas** | The same editor as a route or workflow canvas. Add blocks, connect them and **Save**. |
| **Playground** | Open it from the canvas. Pick any method, type a path, add headers and a body, and press **Send**. You see the status, headers and body of the answer, and an **Open recording** link for the call. Fluxify adds the development token for you and never shows it. |
| **Run** | Starts the sandbox as a workflow with the JSON (or plain text) you type. |
| **Runs** | Every recorded run of this sandbox, newest first. Open one to see it on the canvas, or press **Replay** to send the same request again (see below). |
| **Settings** | **General**: rename the sandbox, and turn **Export traces** on to send its spans to the project's telemetry destination. **Triggers**: the triggers that run this sandbox. Attach one you made on the Triggers page, switch it on or off, or detach it. |

If no development worker is running, a banner says so and **Run** and the
playground are switched off until one starts.

::: info Where the portal sends a playground call
To your project's normal address, at `/_sandbox/<id>/…`. Kit, the production
compose file and the Helm chart already send that path to the development
worker. Only when the development worker has an address of its own does your
operator set `DEV_WORKER_URL`, for example `http://localhost:5602` when you run
Fluxify from source.
:::

## Start from a route or workflow

On a route's or workflow's canvas, **Open in sandbox** copies the whole canvas into a new sandbox named `<name> sandbox` and opens it. The original is not changed, so you can try a fix on development data and copy it back when it works (select the blocks, copy, and paste them on the original canvas).

The copy has the blocks and the connections between them. Some things stay behind, and a dialog tells you before it copies:

| Left behind | Why |
| :--- | :--- |
| The route's middlewares | They are route settings, not blocks. |
| The route's request schemas | They are route settings. A sandbox accepts any body. |

A workflow has neither, so it copies straight away.

## Replay a recorded run

A recorded run of a route, a workflow or a sandbox has a **Replay** button. It opens the route's playground, the Run form of the workflow, or the sandbox's playground, filled in with what the run received: the method, path, query, headers and body of a request, or the payload of a workflow run. Change anything you like and press **Send** or **Run**. Replay never sends anything by itself. A run whose input was too big to keep in full has no Replay.

## Call it over HTTP

Send a request to your development worker at:

```
/_sandbox/<sandbox id>/<anything you like>
```

- **Any method.** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **Any body.** JSON, plain text, a form or a file. Nothing is checked before
  your blocks run.
- **Any path after the id.** Your blocks see it as the request path. A request to
  `/_sandbox/<id>/users/42` has the path `/users/42`.
- **It needs the development access token**, in the `x-fluxify-dev-token` header.
  See [Development access](/concepts/environments#development-access).

```bash
curl -X POST \
  -H "x-fluxify-dev-token: fxd_..." \
  -H "content-type: application/json" \
  -d '{"name": "Ada"}' \
  http://localhost:5602/_sandbox/<sandbox id>/hello
```

In the [Kit](/deployments/kit#dev-worker), the production compose stack and the
Helm chart, this is the same address as the rest of your API
(`http://localhost:8080/_sandbox/<sandbox id>/hello` in the Kit). When you run
Fluxify from source, the development worker is on port `5602`.

| You send | You get |
| :--- | :--- |
| The right token | Your sandbox's answer. |
| No token, or a wrong one | `401` |
| A sandbox id that does not exist, or was deleted | `404` |
| Anything, to a **production** worker | `404`, as for any unknown path. |

::: warning `/_sandbox/` is reserved
Every worker, development or production, keeps every path that starts with
`/_sandbox/` for sandboxes. A route you make at such a path can never be
reached: its requests go to the sandbox handler and get `401` or `404`.
:::

::: info The token never reaches your blocks
Fluxify removes the `x-fluxify-dev-token` header before your blocks run, so it
does not show up in a recording either.
:::

## Run it as a workflow

**Run** starts the sandbox as a workflow, with the input you give it, on a
development worker. It works the same way as a workflow's
[Run](/concepts/workflows) button. The run happens in the background; its
recording shows what it did.

If no development worker is running, Run fails with **"start a worker with
FLUXIFY_ENV=development"**. See
[Starting one](/concepts/environments#starting-one).

## Triggers

A [trigger](/concepts/triggers) can run a sandbox instead of a workflow, for
example to try how your blocks handle real messages from a queue.

- **Attach** a trigger from the sandbox's **Settings > Triggers**. Make the trigger
  on the Triggers page first and leave it attached to nothing. A trigger runs one
  workflow **or** one sandbox, never both.
- **It runs on development workers only**, with your development values: a
  queue trigger reads through the development settings of its integration. A
  production worker never picks it up.
- **It is yours alone.** Like the sandbox, only you can see, change or delete a
  trigger attached to it. On the Triggers page it shows as **Your sandbox**.
- **Every run is recorded**, in the sandbox's **Runs**.
- **A schedule can't run a sandbox.** Use **Run**, a queue trigger or an internal
  trigger.
- **Deleting the sandbox deletes its triggers** too, and they stop at once.

## Custom blocks

Custom blocks work in a sandbox the same way they do on a route. A sandbox
always runs the custom block as it is saved right now. Edit the custom block and
the next sandbox run uses the new version, with no need to save the sandbox
again.

## Recordings

Every run leaves a [recording](/concepts/execution-recording): each request over
HTTP, each Run and each run from a trigger. If a run fails, the failure also
appears in the project's system logs, where only you can see it.

## AI agents

An agent connected through the [MCP server](/getting-started/ai-agents) can make
and use sandboxes as you: `list_sandboxes`, `create_sandbox`, `get_canvas` and
`edit_canvas` on a sandbox, `call_sandbox` to send it a request and
`run_sandbox` to run it as a workflow. The agent never sees the development
token; Fluxify adds it. See the recipe
[Inspect data with DB Native in a sandbox](/agents/recipes/inspect-data-in-sandbox).

`copy_blocks` moves blocks between canvases of one project: a route into a new
sandbox (`to: "__new_sandbox__"`), or the fixed blocks of a sandbox back into
the route. It copies the blocks you name (or the whole canvas), keeps the
connections between them, and never copies the entrypoint or the error handler.
Copying into a route, workflow or custom block asks you to approve first, even
when the agent runs without asking. See
[Debug a route in a sandbox](/agents/recipes/debug-route-in-sandbox).

### A quick try without a sandbox

For a one-off check the agent does not need a sandbox at all. `run_blocks` takes
the blocks and edges in one call, runs them once on a development worker, and
answers with the result and the blocks that ran. Nothing is saved: no sandbox
in your list, no canvas and no recording. The only trace is one `ephemeral`
system log that only you can read, deleted after the same number of days as
recordings. See
[Try blocks with an ephemeral run](/agents/recipes/ephemeral-run).

## Deleting a sandbox

Deleting a sandbox removes its canvas, its triggers and its recordings. Its
address answers `404` from then on.

## Related

- [Environments](/concepts/environments)
- [Workflows](/concepts/workflows)
- [Execution Recording](/concepts/execution-recording)
