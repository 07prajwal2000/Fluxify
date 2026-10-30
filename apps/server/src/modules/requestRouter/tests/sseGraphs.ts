import { BlockTypes, type BlockDTOType } from "@fluxify/blocks";

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const chain = (ids: string[]) =>
	ids.slice(1).map((to, i) => ({
		id: `edge-${ids[i]}-${to}`,
		from: ids[i]!,
		to,
		fromHandle: "source",
		toHandle: "source",
	}));

/**
 * The route, as a user would write it before Hold connection (#1024): connect,
 * say so (a send waits for the subscription, so the client knows it is held),
 * then keep the run alive until the stream ends.
 */
export function routeGraph() {
	return {
		blocks: [
			block("in", BlockTypes.entrypoint),
			block("js", BlockTypes.jsrunner, {
				value: [
					`const handle = sse.connect(getQueryParam("id"));`,
					`await sse.send(handle, "connected " + sse.connectionId);`,
					`await new Promise((resolve) => sse.signal(handle).addEventListener("abort", resolve));`,
					`return handle;`,
				].join("\n"),
			}),
			block("out", BlockTypes.response, { httpCode: "200" }),
		],
		edges: chain(["in", "js", "out"]),
	};
}

/** A workflow that streams to a handle it was given, then closes the stream when told to. */
export function workflowGraph() {
	return {
		blocks: [
			block("in", BlockTypes.entrypoint),
			block("js", BlockTypes.jsrunner, {
				value: [
					`for (const token of input.tokens) await sse.send(input.handle, token, { event: "token" });`,
					`if (input.close) await sse.close(input.handle);`,
					`return true;`,
				].join("\n"),
			}),
		],
		edges: chain(["in", "js"]),
	};
}
