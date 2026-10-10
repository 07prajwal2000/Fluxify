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
| **Runs** | Every recorded run of this sandbox, newest first. Open one to see it on the canvas. |
| **Settings** | Rename the sandbox, and turn **Export traces** on to send its spans to the project's telemetry destination. |

If no development worker is running, a banner says so and **Run** and the
playground are switched off until one starts.

::: info Where the portal sends a playground call
To your project's normal address, at `/_sandbox/<id>/…`. Kit, the production
compose file and the Helm chart already send that path to the development
worker. Only when the development worker has an address of its own does your
operator set `DEV_WORKER_URL`, for example `http://localhost:5602` when you run
Fluxify from source.
:::

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

## Custom blocks

Custom blocks work in a sandbox the same way they do on a route. A sandbox
always runs the custom block as it is saved right now. Edit the custom block and
the next sandbox run uses the new version, with no need to save the sandbox
again.

## Recordings

Every run leaves a [recording](/concepts/execution-recording): each request over
HTTP and each Run. If a run fails, the failure also appears in the project's
system logs.

## Deleting a sandbox

Deleting a sandbox removes its canvas and its recordings. Its address answers
`404` from then on.

::: tip Coming next
Triggers that start a sandbox, and sandbox tools for AI agents, are on the way.
:::

## Related

- [Environments](/concepts/environments)
- [Workflows](/concepts/workflows)
- [Execution Recording](/concepts/execution-recording)
