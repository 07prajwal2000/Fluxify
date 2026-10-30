import { describe, expect, it } from "bun:test";
import { block, param } from "../blocks.js";
import { BAD_HANDLE, parseHandle } from "../runtime.js";
import { fakeSse, runBlock } from "../testing.js";

/** streams tokens until the client leaves, then closes: an AI agent block's shape */
const streamer = block({
	name: "acme/ai/stream",
	label: "Stream",
	params: { handle: param.string({ required: true }), tokens: param.number({ default: 5 }) },
	async run({ params, ctx }) {
		const signal = ctx.sse.signal(params.handle);
		let n = 0;
		while (n < params.tokens && !signal.aborted)
			await ctx.sse.send(params.handle, { token: n++ }, { event: "token", eventId: String(n) });
		await ctx.sse.close(params.handle);
		return { output: { sent: n, aborted: signal.aborted } };
	},
});

describe("ctx.sse in runBlock", () => {
	it("records sent events in their wire form and the close", async () => {
		const r = await runBlock(streamer, { params: { handle: "int_1:conv", tokens: 2 } });
		expect(r.output).toEqual({ sent: 2, aborted: true });
		expect(r.sse.sent).toEqual([
			{ handle: "int_1:conv", data: '{"token":0}', event: "token", eventId: "1" },
			{ handle: "int_1:conv", data: '{"token":1}', event: "token", eventId: "2" },
		]);
		expect(r.sse.closed).toEqual(["int_1:conv"]);
	});

	it("stops the block when the test disconnects mid-stream", async () => {
		const sse = fakeSse({
			onSend: (e) => {
				if (e.eventId === "3") sse.disconnect(e.handle);
			},
		});
		const r = await runBlock(streamer, { params: { handle: "int_1:conv" }, ctx: { sse } });
		expect(r.output).toEqual({ sent: 3, aborted: true });
		expect(r.sse).toBe(sse);
	});

	it("follows the worker's rules: strings as-is, one signal per handle, drops after close", async () => {
		const sse = fakeSse();
		await sse.send("int_1:a:b", "line one\nline two");
		expect(sse.sent[0]).toEqual({ handle: "int_1:a:b", data: "line one\nline two" });
		expect(sse.signal("int_1:a:b")).toBe(sse.signal("int_1:a:b"));
		await sse.close("int_1:a:b");
		await sse.close("int_1:a:b");
		await sse.send("int_1:a:b", "late");
		expect(sse.sent).toHaveLength(1);
		expect(sse.closed).toEqual(["int_1:a:b", "int_1:a:b"]);
		expect(sse.signal("int_1:a:b").aborted).toBe(true);
	});

	it("rejects a malformed handle like the runtime", async () => {
		const sse = fakeSse();
		await expect(sse.send("nope", "x")).rejects.toThrow(BAD_HANDLE);
		await expect(sse.close(":x")).rejects.toThrow(BAD_HANDLE);
		expect(() => sse.signal("int_1:")).toThrow(BAD_HANDLE);
		expect(parseHandle("int_1:a:b")).toEqual({ integrationId: "int_1", id: "a:b" });
	});
});
