---
title: Streaming responses (SSE)
description: Send events to a client while your route, a workflow or a plugin block is still working, using server-sent events. Covers the broker setting, connect, send, close, reconnecting, a browser client, limits and errors.
---

# Streaming responses (SSE)

A route normally answers once, with one JSON body, when its flow ends. Some answers can't wait for that: AI tokens as they are generated, progress of a long job, live updates. **Server-sent events** (SSE) let a route keep the connection open and push events to the client while the work happens. The work can happen anywhere: in the route itself, in a background [workflow](/concepts/workflows), in a custom block or in a plugin block.

This page walks through the whole setup.

## How it fits together

1. The client calls your route.
2. The route calls `sse.connect(id)`. From that moment the reply is an event stream, not a JSON body. You get back a **handle**, a short string that points at this stream.
3. You pass the handle to whatever produces the data, such as a workflow.
4. That producer calls `sse.send(handle, data)` for each event and `sse.close(handle)` when it is done.
5. Each event reaches the client, even when the producer runs on a different server from the one that holds the connection.

Events travel through a **broker**: a NATS or Redis integration of your own. That is how an event sent on one server reaches the server that holds the client's connection.

## 1. Pick a broker

Open the route, then **Route settings → Advanced → Streaming → SSE broker**, and choose one of your project's integrations:

| Broker | Integration |
| :--- | :--- |
| NATS | A [message queue](/integrations/message-queues) integration of the NATS kind |
| Redis | A [key-value store](/integrations/kv-stores) integration of the Redis kind |

Only NATS and Redis integrations are listed. There is no separate "SSE enabled" switch: a route stays a normal JSON route until its code calls `sse.connect`. Picking a broker only makes streaming possible.

::: tip One broker per route
Every route that streams needs its own broker setting, but many routes can share the same integration. Streams of different projects never mix, even on a shared broker.
:::

## 2. Connect in the route

Call `sse.connect(id)` in a [JS Runner](/blocks/js-runner) block on the route. The `id` is yours to choose: a conversation id, a job id, a user id. It names the stream.

```js
const handle = sse.connect(getQueryParam("conversation"));
return { handle };
```

- `connect` returns the handle, in the form `<integrationId>:<id>`, for example `int_8f2a:conv_123`.
- `sse.connectionId` is the same handle, readable anywhere later in this request.
- `connect` works only on a route. In a workflow or a job it throws.

::: danger Check who is asking first
The route decides who may connect to an id, not the client. Calling `connect` with an id **takes that stream over** from whoever held it before. If ids are easy to guess and the route has no auth check, anyone can take over someone else's stream and read what is sent to it. Check the caller (for example with [JWT auth](/agents/recipes/route-jwt-auth)) and that the id belongs to them **before** calling `connect`.
:::

## 3. Keep the stream open: Hold connection

When the route's flow ends, the stream ends too, unless you hold it. Turn on **Hold connection** on the route's [Response](/blocks/response#hold-connection) block:

- The Response block's body is sent as the **first event**. A `null` body sends no event.
- The flow ends as usual, but the connection stays open for later events.

Without Hold connection, everything you want to send must be sent before the flow ends.

## 4. Hand the handle to the producer

Pass the handle like any other value. To stream from a background workflow, start it with a [Trigger Workflow](/blocks/trigger-workflow) block and put the handle in its data:

| Field | Value |
| :--- | :--- |
| Workflow | `answer-question` |
| Data | `{ "handle": "js: return sse.connectionId;", "question": "js: return getRequestBody().question;" }` |

The workflow reads it as `input.handle`. The handle carries everything needed to find the stream, so the workflow never needs to know which route it came from.

## 5. Send events

```js
await sse.send(input.handle, "Hello");
await sse.send(input.handle, { progress: 40 }, { event: "progress", eventId: "4" });
```

| Argument | What it does |
| :--- | :--- |
| `handle` | The handle from `connect` |
| `data` | Text is sent as it is. Anything else is sent as JSON. Text with several lines becomes one `data:` line per line, and the client puts them back together |
| `event` | Optional. The event name the client listens for. Without it, the client sees a plain `message` |
| `eventId` | Optional. The event's `id:` field |

`sse.send`, `sse.close` and `sse.signal` work in routes, workflows and custom blocks, on any server. Plugin blocks use the same calls as [`ctx.sse`](/plugins/authoring/context#ctx-sse).

## 6. Stop when nobody is listening

`sse.signal(handle)` returns an `AbortSignal` that aborts when:

- the client disconnected,
- the stream was closed, or
- another connection took the id over.

Check it in a loop, or hand it to anything that accepts a signal, so the work stops when nobody is reading:

```js
const signal = sse.signal(input.handle);
for (const step of steps) {
	if (signal.aborted) break;
	await sse.send(input.handle, await runStep(step));
}
```

This matters most for AI calls: a model that keeps generating for a closed tab still costs tokens. See [Stream an AI response](/agents/recipes/stream-ai-response).

If the broker can't be reached, the signal aborts too, because Fluxify can no longer tell whether the client is still there.

## 7. Close

```js
await sse.close(input.handle);
```

The client's connection ends. Calling `close` twice is safe, and it works from any server.

## Reconnecting

To reconnect, the client calls the route again **with the same id**. The new connection takes the id over, and any older connection to it (another tab, a stale socket) is closed. There is nothing else to set up.

::: warning Events in the gap are lost
Events sent while no client is connected are not stored. A client that reconnects gets only the events sent after it is back. Replaying missed events (`Last-Event-ID`) is not supported.
:::

A worker restart also drops its open streams. Clients reconnect the same way.

## A browser client

The browser's built-in `EventSource` reads the stream:

```js
const source = new EventSource(`/chat?conversation=${encodeURIComponent(conversationId)}`);

source.onmessage = (e) => {
	output.textContent += e.data; // events sent without a name
};
source.addEventListener("progress", (e) => {
	showProgress(JSON.parse(e.data).progress);
});
source.addEventListener("done", () => source.close());
source.addEventListener("error", (e) => {
	if (e.data) console.error(JSON.parse(e.data).message); // an error event from Fluxify
});
```

Two things to know about `EventSource`:

- **It reconnects by itself** a few seconds after the stream ends. Since reconnecting means calling the route again, send a last event (such as `done`) and call `source.close()` when you get it.
- **It can't send custom headers.** Authenticate with a cookie, or read the stream with `fetch` and `response.body.getReader()` when you need an `Authorization` header.

## Limits

| Limit | Value | What happens |
| :--- | :--- | :--- |
| No message for too long | 60 seconds by default | The client gets an `error` event, `{"message":"SSE stream timed out"}`, and the stream closes. Every `send` resets the clock. The server setting is [`SSE_LIVENESS_TIMEOUT`](/deployments/production#sse-liveness) |
| Keep-alive | Every 15 seconds, or half the timeout if that is shorter | A `: ping` comment line. Clients ignore it. It keeps proxies from cutting the connection, but does **not** reset the timeout above |
| Client not reading | About 1 MB of waiting events | The client is disconnected |
| Async replies | Not supported | A route that answers `202` right away can't stream |
| One stream per request | | Calling `connect` twice in one request throws |

The route's own timeout does not end a held stream. The timeout above does.

## Errors

| Error | Cause |
| :--- | :--- |
| `SSE needs a broker integration in route settings` | `connect` ran on a route with no SSE broker. Pick one in route settings |
| `sse.connect can only be used in a route` | `connect` ran in a workflow or a job |
| `sse.connect needs an id` | The id was empty or not text |
| `SSE cannot be used with async replies` | The route answers asynchronously (`202`) |
| `This request already opened an SSE stream` | `connect` ran twice in the same request |
| `not an SSE connection handle` | `send`, `close` or `signal` got something that is not a handle. Pass the handle from `connect` unchanged |

If the flow throws an error after `connect`, the client gets an `error` event with the message, and the stream closes. The same happens if the broker fails.

::: info Test suites
[Test suites](/testing/) don't collect events yet. A route that calls `connect` fails there with the "needs a broker" error. Try streaming routes with `curl -N` or a browser instead.
:::

## Related

- [Response block](/blocks/response#hold-connection): Hold connection.
- [Trigger Workflow](/blocks/trigger-workflow): hand the handle to a workflow.
- [Plugin context](/plugins/authoring/context#ctx-sse): `ctx.sse` in plugin blocks.
- [Streaming response timeout](/deployments/production#sse-liveness): the server setting.
