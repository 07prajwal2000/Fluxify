import { describe, expect, it } from "bun:test";
import type { JSONValue, ModelMessage } from "ai";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { SUMMARY_HEAD, summarize } from "./compact";

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
/** A model that answers "s" and records the summary prompt it was given. */
const recorder = () => {
	const prompts: string[] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async (call) => {
			prompts.push(JSON.stringify(call.prompt));
			return {
				content: [{ type: "text", text: "the summary" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			};
		},
	});
	return { model, prompts };
};

const step = (id: string, name: string, input: object, value: JSONValue): ModelMessage[] => [
	{ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: name, input }] },
	{
		role: "tool",
		content: [
			{ type: "tool-result", toolCallId: id, toolName: name, output: { type: "json", value } },
		],
	},
];
const edit = (id: string, target: string) =>
	step(id, "edit_canvas", { target: { kind: "route", id: target }, version: 1, ops: [] }, { version: 2 });

/** A conversation with enough steps for a summary to cover the first ones. */
const chat = (...early: ModelMessage[][]): ModelMessage[] => [
	{ role: "user", content: "build it" },
	...early.flat(),
	...[1, 2, 3].flatMap((i) => step(`t${i}`, "get_route", {}, "ok")),
	{ role: "user", content: "now test it" },
];

describe("the summary prompt", () => {
	it("asks for exact shapes copied word for word", async () => {
		const r = recorder();
		await summarize(r.model, chat(edit("e1", "a")));
		const p = r.prompts[0];
		expect(p).toContain("copied word for word, never paraphrased");
		expect(p).toContain("response body and error body a route returned, with its status code");
		expect(p).toContain("block keys");
		expect(p).toContain("test suite: its id and what it asserts");
	});

	it("shows the summarizer route answers, test suites and errors in full, other results clipped", async () => {
		const r = recorder();
		const body = `${"b".repeat(5000)}END`;
		await summarize(
			r.model,
			chat(
				step("c1", "call_route", { routeId: "r" }, { status: 409, body }),
				step("s1", "save_test_suite", { assertions: body }, { id: "t1" }),
				step("g1", "get_recording", {}, body),
			),
		);
		const sent = r.prompts[0];
		expect(sent.match(/END/g)).toHaveLength(2); // call_route result and save_test_suite call, not get_recording
		expect(sent).toContain("409");
	});
});

describe("the canvas after a summary", () => {
	const canvases = () => {
		const asked: unknown[] = [];
		const tools = {
			get_canvas: tool({
				inputSchema: z.object({}).passthrough(),
				execute: async (input: any) => {
					asked.push(input);
					if (input.target.id === "gone") throw new Error("no such route");
					return { version: 7, blocks: [{ key: "kv_set_9", type: "kv_set" }], edges: [] };
				},
			}),
		};
		return { tools, asked };
	};

	it("re-attaches the compact canvas of every edited target, once each", async () => {
		const { tools, asked } = canvases();
		const r = await summarize(
			recorder().model,
			chat(edit("e1", "a"), edit("e2", "b"), edit("e3", "a"), edit("e4", "gone")),
			{ tools },
		);
		expect(asked).toEqual([
			{ target: { kind: "route", id: "a" }, compact: true },
			{ target: { kind: "route", id: "b" }, compact: true },
			{ target: { kind: "route", id: "gone" }, compact: true },
		]);
		const text = String(r?.messages[0].content);
		expect(text).toStartWith(`${SUMMARY_HEAD}the summary`);
		expect(text).toContain("[canvas route a]");
		expect(text).toContain("[canvas route b]");
		expect(text).toContain('"key":"kv_set_9"');
		expect(text).not.toContain("[canvas route gone]"); // unreadable: left out, no failure
	});

	it("attaches nothing when nothing was edited or no tools are given", async () => {
		const { tools, asked } = canvases();
		const none = await summarize(recorder().model, chat(), { tools });
		expect(String(none?.messages[0].content)).toBe(`${SUMMARY_HEAD}the summary`);
		expect(asked).toEqual([]);
		const noTools = await summarize(recorder().model, chat(edit("e1", "a")));
		expect(String(noTools?.messages[0].content)).toBe(`${SUMMARY_HEAD}the summary`);
	});

	it("a second summary keeps the targets of the first, with fresh canvases and no stale ones in its prompt", async () => {
		const { tools, asked } = canvases();
		const first = await summarize(recorder().model, chat(edit("e1", "a")), { tools });
		const earlier = first?.messages[0] as ModelMessage;
		asked.length = 0;
		const r = recorder();
		const second = await summarize(
			r.model,
			[earlier, { role: "user", content: "more" }, ...chat(edit("e2", "b")).slice(1)],
			{ tools },
		);
		expect(asked.map((a: any) => a.target.id)).toEqual(["a", "b"]);
		expect(r.prompts[0]).toContain("the summary"); // the earlier summary text is there
		expect(r.prompts[0]).not.toContain("kv_set_9"); // its old canvas is not
		expect(String(second?.messages[0].content).match(/\[canvas route /g)).toHaveLength(2);
	});

	it("reports the size with the canvases in it", async () => {
		const { tools } = canvases();
		const messages = chat(edit("e1", "a"));
		const plain = await summarize(recorder().model, messages);
		const withCanvas = await summarize(recorder().model, messages, { tools });
		expect(withCanvas!.event.after).toBeGreaterThan(plain!.event.after);
	});
});
