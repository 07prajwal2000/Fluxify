import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentStore, RunStatus } from "../store";
import { executeCompact } from "./compactJob";
import type { AgentEvent } from "./events";
import type { RunDeps } from "./job";
import type { AgentJob } from "./queue";

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const chat: ModelMessage[] = [
	{ role: "user", content: "build a route" },
	{ role: "assistant", content: "built" },
	{ role: "user", content: "now test it" },
	{ role: "assistant", content: "tested" },
];

/** A compact job's world in memory: the rows it reads, the summaries it saves, what it publishes. */
function world(messages: ModelMessage[] = chat, summary: () => string = () => "the summary") {
	const state = {
		run: "queued" as RunStatus,
		settled: [] as RunStatus[],
		prompts: [] as string[],
	};
	const saved: { covers: number; summary: ModelMessage; stats: unknown }[] = [];
	const sent: AgentEvent[][] = [];
	const store = {
		modelView: async () => messages.map((message, seq) => ({ message, seq })),
		appendSummary: async (
			_c: string,
			_r: string,
			summary: ModelMessage,
			covers: number,
			stats: unknown,
		) => {
			saved.push({ covers, summary, stats });
			return messages.length;
		},
		setRunStatus: async (_r: string, s: RunStatus) => {
			state.run = s;
		},
	} as unknown as AgentStore;
	const model = new MockLanguageModelV4({
		doGenerate: async (call) => {
			state.prompts.push(JSON.stringify(call.prompt));
			return {
				content: [{ type: "text", text: summary() }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			};
		},
	});
	const deps: RunDeps = {
		store,
		claimRun: async () => {
			if (state.run !== "queued") return false;
			state.run = "executing";
			return true;
		},
		settle: async (_c, _r, s) => void state.settled.push(s),
		build: async () => ({ model, tools: {}, projectId: "p", limits: {}, mode: "manual" }) as never,
		publish: async (_r, e) => void sent.push(structuredClone(e)),
		batchMs: 5,
	};
	return { deps, state, saved, events: () => sent.flat() };
}

const job = (over: Partial<AgentJob> = {}): AgentJob => ({
	type: "compact",
	conversationId: "c",
	runId: "r",
	userId: "u",
	projectId: "p",
	mode: "manual",
	...over,
});
const go = (w: ReturnType<typeof world>, j = job(), signal = new AbortController().signal) =>
	executeCompact(j, w.deps, signal);

describe("executeCompact", () => {
	it("saves the summary row with its stats, streams the compaction, then done, with no model turn", async () => {
		const w = world();
		expect(await go(w)).toBe("completed");
		expect(w.saved).toHaveLength(1);
		expect(w.saved[0].covers).toBe(1);
		expect(w.saved[0].summary).toEqual({
			role: "user",
			content: "Summary of the earlier conversation:\nthe summary",
		});
		expect(w.saved[0].stats).toMatchObject({ kind: "summary", coversUpTo: 2 });
		const ev = w.events();
		expect(ev.map((e) => e.type)).toEqual(["compaction", "done"]);
		expect(ev[0]).toMatchObject({ type: "compaction", compaction: { kind: "summary" } });
		expect(ev[1]).toMatchObject({ type: "done", status: "completed" });
		expect(w.state.run).toBe("completed");
		expect(w.state.settled).toEqual(["completed"]);
		// one model call, the summary: no turn after it
		expect(w.state.prompts).toHaveLength(1);
	});

	it("passes what to keep into the summary prompt", async () => {
		const w = world();
		await go(w, job({ keep: "the users table schema" }));
		expect(w.state.prompts[0]).toContain("The user asks you to keep: the users table schema");
	});

	it("nothing to cover: no row, no compaction, the run still ends", async () => {
		const w = world([chat[0]]);
		expect(await go(w)).toBe("completed");
		expect(w.saved).toEqual([]);
		expect(w.events().map((e) => e.type)).toEqual(["done"]);
		expect(w.state.prompts).toHaveLength(0);
	});

	it("a failed summary is a summary-failed compaction; the run completes and nothing is saved", async () => {
		const w = world(chat, () => " ");
		expect(await go(w)).toBe("completed");
		expect(w.saved).toEqual([]);
		expect(w.events()[0]).toMatchObject({
			type: "compaction",
			compaction: { kind: "summary-failed", error: "the model returned an empty summary" },
		});
		expect(w.events().at(-1)).toMatchObject({ type: "done", status: "completed" });
	});

	it("a stop ends it interrupted", async () => {
		const w = world();
		const ctrl = new AbortController();
		ctrl.abort(new Error("Stopped by user"));
		w.deps.build = async () => {
			throw new Error("Stopped by user");
		};
		expect(await go(w, job(), ctrl.signal)).toBe("interrupted");
		expect(w.state.settled).toEqual(["interrupted"]);
		expect(w.events().map((e) => e.type)).toEqual(["done"]);
	});

	it("a duplicate delivery is skipped before any work", async () => {
		const w = world();
		w.state.run = "executing";
		expect(await go(w)).toBe("skipped");
		expect(w.events()).toEqual([]);
		expect(w.saved).toEqual([]);
	});
});
