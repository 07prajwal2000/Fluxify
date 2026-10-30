---
title: Recipe - stream an AI response
description: Build a route that streams an AI answer token by token with server-sent events. The route connects, a workflow calls the model and sends each token, stops when the client leaves, then closes the stream.
---

# Recipe - stream an AI response

Goal: `GET /chat?conversation=<id>&q=<question>` answers with an event stream. Each token of the model's answer arrives as a `token` event, then a `done` event, then the stream closes. If the user closes the tab, the model call stops.

Read [Streaming responses](/getting-started/streaming) for how streaming works, and the [Canvas guide](/agents/canvas) for `edit_canvas`. Block keys below (`entrypoint_1`, `response_1`) are the ones `get_canvas` shows; yours may differ.

The plan:

1. A NATS or Redis integration is the broker.
2. A workflow calls the model and sends tokens with the handle it receives.
3. The route connects, starts the workflow with the handle, and holds the connection.

## 1. Find a broker

Call `list_integrations` and pick one with group `queue` and variant `NATS`, or group `kv` and variant `Redis`. If there is none, create one with `save_integration` ([Integration reference](/agents/integration)), or ask the user which one to use.

Keep the model's API key in app config, for example `OPENAI_API_KEY` (`save_app_config`). Never write a key into a script.

## 2. The workflow

Create it with `save_workflow`. Give it enough time for a long answer:

```json
{ "projectId": "<project id>", "name": "Stream answer", "timeoutSeconds": 300 }
```

Its canvas: the entrypoint, then one JS Runner. The workflow's `input` is the data the route sends: `{ handle, question }`.

```json
{
  "target": { "kind": "workflow", "id": "<workflow id>" },
  "revision": 0,
  "ops": [
    { "op": "add_block", "ref": "llm", "type": "jsrunner",
      "data": { "blockName": "Stream from model", "value": "<the script below>" },
      "connect_from": { "from": "entrypoint_1" } }
  ]
}
```

The script calls an OpenAI-compatible chat API with `stream: true`, and sends each token as it arrives:

```js
const { handle, question } = input;
// aborts when the client leaves, the stream closes, or another tab takes the id over
const signal = sse.signal(handle);
try {
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		signal,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${getConfig("OPENAI_API_KEY")}`,
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			stream: true,
			messages: [{ role: "user", content: question }],
		}),
	});
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		const lines = buffer.split("\n");
		buffer = lines.pop();
		for (const line of lines) {
			if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
			const token = JSON.parse(line.slice(6)).choices[0]?.delta?.content;
			if (token) await sse.send(handle, token, { event: "token" });
		}
	}
	await sse.send(handle, "", { event: "done" });
} catch (error) {
	// the client left: stopping is the point, not a failure
	if (!signal.aborted) throw error;
} finally {
	await sse.close(handle);
}
return true;
```

Why each part is there:

- **`signal` on `fetch`.** When the user leaves, the model request is cancelled, so it stops spending tokens. `abortSignal` is `undefined` in a workflow; `sse.signal(handle)` is the one that knows about the client.
- **`done` event.** The browser's `EventSource` reconnects by itself when a stream ends. The client closes it when `done` arrives.
- **`close` in `finally`.** The stream ends on success, on failure and on abort. Without it, the client waits for the 60-second timeout.

::: tip A plugin AI block instead
A [plugin block](/plugins/authoring/context#ctx-sse) can do the same with an AI integration and the AI SDK's `streamText`, using `ctx.sse.send`, `ctx.sse.signal` and `ctx.sse.close`. Give the block a param for the handle and put it in the workflow in place of the JS Runner.
:::

## 3. The route

Create the route with its broker:

```json
{
  "projectId": "<project id>",
  "name": "Chat stream",
  "path": "/chat",
  "method": "GET",
  "sseBrokerId": "<broker integration id>"
}
```

Then its canvas. A new route has `entrypoint_1 → response_1`, so disconnect that first.

```json
{
  "target": { "kind": "route", "id": "<route id>" },
  "revision": 0,
  "ops": [
    { "op": "disconnect", "from": "entrypoint_1", "to": "response_1" },
    { "op": "add_block", "ref": "connect", "type": "jsrunner",
      "data": {
        "blockName": "Connect",
        "value": "const conversation = getQueryParam('conversation');\nif (!conversation) throw new ValidationError('conversation is required');\n// check here that the caller owns this conversation\nconst handle = sse.connect(conversation);\nreturn { handle, question: getQueryParam('q') ?? '' };"
      },
      "connect_from": { "from": "entrypoint_1" } },
    { "op": "add_block", "ref": "start", "type": "trigger_workflow",
      "data": { "blockName": "Start answer", "workflowId": "<workflow id>", "mode": "now", "useInput": true },
      "connect_from": { "from": "connect" } },
    { "op": "connect", "from": "start", "to": "response_1" },
    { "op": "update_block", "id": "response_1",
      "data": { "holdConnection": true, "transformEnabled": true,
                "transformScript": "return { started: true };" } }
  ]
}
```

- **Connect** turns the reply into a stream and returns the handle. `useInput: true` on the Trigger Workflow block sends `{ handle, question }` as the workflow's data.
- **Trigger Workflow** does not wait, so the route reaches its Response right away.
- **Hold connection** sends `{"started":true}` as the first event and keeps the stream open for the workflow's tokens. Without it, the stream would close as soon as the route ends.

::: danger Add the auth check
`connect` takes the conversation over from anyone already connected to it. Before going live, check the caller and that the conversation is theirs, in the Connect block, before `sse.connect`. See [JWT auth](/agents/recipes/route-jwt-auth).
:::

## 4. Try it

Test suites don't collect stream events yet, and `call_route` waits for a single answer. Ask the user to try it from a terminal:

```bash
curl -N "<route url>/chat?conversation=demo-1&q=Say%20hello"
```

Expected output, one block per event:

```
data: {"started":true}

event: token
data: Hello

event: token
data: !

event: done
data:
```

A browser client:

```js
const source = new EventSource("/chat?conversation=demo-1&q=Say%20hello");
source.addEventListener("token", (e) => (answer.textContent += e.data));
source.addEventListener("done", () => source.close());
```

If nothing arrives, read the workflow's runs and `get_system_logs`. The common causes:

| Symptom | Cause |
| :--- | :--- |
| `SSE needs a broker integration in route settings` | `sseBrokerId` is not set on the route |
| The stream closes right after `{"started":true}` | The workflow failed. Its run shows the error |
| `error` event `SSE stream timed out` | Nothing was sent for 60 seconds: the workflow never started (check it is switched on), or the model sent no tokens yet |
