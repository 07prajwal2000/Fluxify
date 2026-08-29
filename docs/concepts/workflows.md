# Workflows

A **workflow** is work that runs in the background. Nobody is waiting for the
answer, there is no URL to call, and it can take minutes rather than
milliseconds.

You build one exactly the way you build a route: drag blocks onto a canvas,
connect them, save. Everything you already know — blocks, variables, database
integrations, custom blocks, JavaScript — works the same way. The difference is
what starts it and what happens when it finishes.

## Workflow or route?

| | Route | Workflow |
|---|---|---|
| **How it starts** | Someone calls a URL | A trigger fires, or you run it manually |
| **Who waits for it** | The caller, holding the connection open | Nobody |
| **Gives back** | An HTTP response | Nothing — it just finishes |
| **Has** | A path, a method, request validation | An input shape, if you want one |
| **Default time limit** | 30 seconds | 5 minutes |
| **If it fails** | The caller sees an error | It is retried automatically |

::: tip Rule of thumb
If something is waiting for the result, make it a route. If you are kicking off
work and moving on — sending a nightly digest, rebuilding a report, syncing an
external system — make it a workflow.
:::

## Building one

1. Create a workflow and give it a name. It starts with an **entrypoint** and an
   **error handler**, the same two blocks every canvas has.
2. Add your blocks and connect them from the entrypoint.
3. Save the canvas.
4. **Activate it.** An inactive workflow is never published to your workers, so
   nothing can run it — not a trigger, not a manual run.

There is no **response** block on a workflow canvas. There is nothing to respond
to, so anything the last block produces is simply the end of the run.

## Giving it input

A workflow can accept a payload — the same idea as a route's request body. Whoever
starts the run supplies it, and your blocks read it exactly as they would read a
request body.

You can describe the shape you expect, and Fluxify will reject a run whose
payload does not match before any of your blocks execute. That check works the
same way as request validation on a route.

### What a payload can contain

Anything that can be written as JSON — an object, a list, a number, or just a
string of text.

Files and other binary data cannot travel as JSON. Send them the way images are
sent everywhere else: encode the bytes as base64 (or hex) and say which you
used.

```json
{
  "customerId": "cus_1024",
  "attachment": {
    "mediaType": "application/pdf",
    "encoding": "base64",
    "data": "JVBERi0xLjQKJcfs..."
  }
}
```

Your blocks decode it when they need the bytes.

## Running one by hand

Every workflow has a **Run** action that queues a single run with a payload you
type in. It is how you test a workflow before attaching a trigger to it.

The run is queued, not executed on the spot — you get a run id back immediately
and the work happens on a worker. Two things are worth knowing:

- The workflow has to be **active**. An inactive one is refused straight away,
  rather than accepted and then silently never run.
- Your payload is checked against the input shape first, if you defined one.

## When a run fails

A route reports a failure to whoever called it. A workflow has nobody to tell, so
it is **retried instead** — a few times, with a pause in between. If every
attempt fails, the run is abandoned and recorded as failed.

This is why a workflow should be safe to run twice. If a run charges a card or
sends an email, guard it so a retry does not do it again.

## Time limits

A workflow may run for up to **5 minutes** by default, and you can raise that to
an hour. A route's limit is 30 seconds, because a caller is holding a connection
open the whole time; nobody is holding anything open for a workflow.

Long-running does not mean unbounded. Pick a limit that reflects what the work
should take, so a stuck run is stopped rather than occupying a worker
indefinitely.

## Where workflows run

Workflows execute on your workers, alongside your routes. A worker can be set up
to serve routes, run workflows, or do both — see
[Deployments](/deployments/production) if you run separate machines for
background work.

::: info One worker setup per project
A project's workers must all be configured the same way. Two workers set up
differently for the same project will refuse to start, rather than quietly run
every workflow twice.
:::
