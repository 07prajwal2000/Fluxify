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

Port `5602` is the development worker in the [Kit](/deployments/kit#dev-worker)
and when you run Fluxify from source.

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
The sandbox screens in the portal (list, canvas and a playground to send
requests) and triggers that start a sandbox are on the way. Until then you
manage sandboxes through the admin API.
:::

## Related

- [Environments](/concepts/environments)
- [Workflows](/concepts/workflows)
- [Execution Recording](/concepts/execution-recording)
