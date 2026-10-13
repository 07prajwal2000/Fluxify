import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@fluxify/ai-gateway/src/agent/runner/events";
import type { AgentRow } from "@/services/agentConversations";
import {
	applyEvent,
	chatView,
	type ChatMessage,
	EMPTY_LIVE,
	type Live,
	messageKey,
	phaseOf,
	showsNothing,
	toMessages,
} from "./agentMessages";

const play = (events: [AgentEvent, number][], live: Live = EMPTY_LIVE) =>
	events.reduce((l, [e, now]) => applyEvent(l, e, now), live);
const reasoning = (live: Live) =>
	live.messages.flatMap((m) => m.parts.filter((p) => p.type === "reasoning"));

describe("one timer per model call", () => {
	// think (seq 1) 0-40s, a tool until 270s, think again (seq 3) from 270s
	const events: [AgentEvent, number][] = [
		[{ type: "reasoning", seq: 1, text: "hmm" }, 0],
		[{ type: "reasoning", seq: 1, text: " more" }, 20_000],
		[
			{ type: "tool-start", seq: 1, toolCallId: "t", toolName: "get_route", toolTitle: "Get", input: {} },
			40_000,
		],
		[{ type: "tool-end", seq: 2, toolCallId: "t", toolName: "get_route", status: "done" }, 270_000],
		[{ type: "reasoning", seq: 3, text: "again" }, 271_000],
	];

	test("a finished thought has its own time and the second call starts near 0", () => {
		const live = play(events);
		const [first, second] = reasoning(live);
		expect(first).toMatchObject({ text: "hmm more", startedAt: 0, ms: 40_000 });
		// still streaming: no end yet, timed from its own first token
		expect(second).toMatchObject({ text: "again", startedAt: 271_000 });
		expect((second as { ms?: number }).ms).toBeUndefined();
		// the next call began when the tool result came in, not when the run did
		expect(live.callStartedAt).toBe(270_000);
	});

	test("reasoning of different steps stays in separate messages", () => {
		const live = play(events);
		expect(live.messages.map((m) => [m.role, m.seq])).toEqual([
			["assistant", 1],
			["assistant", 3],
		]);
	});

	test("a thought ends where the answer text starts, and at the end of the run", () => {
		const live = play([
			[{ type: "reasoning", seq: 1, text: "hmm" }, 1000],
			[{ type: "text", seq: 1, text: "ok" }, 6000],
		]);
		expect(reasoning(live)[0]).toMatchObject({ ms: 5000 });
		const open = play([[{ type: "reasoning", seq: 1, text: "hmm" }, 1000]]);
		const done = applyEvent(open, { type: "done", seq: 1, status: "completed" }, 4000);
		expect(reasoning(done)[0]).toMatchObject({ ms: 3000 });
	});
});

describe("compaction lines", () => {
	const summary: AgentEvent = {
		type: "compaction",
		seq: 7,
		compaction: { type: "compaction", kind: "summary", messages: 12, coversUpTo: 12, before: 102_000, after: 9000 },
	};
	const trim: AgentEvent = {
		type: "compaction",
		seq: 9,
		compaction: { type: "compaction", kind: "trim", results: 12, tools: { get_recording: 12 }, before: 41000, after: 12000 },
	};

	test("a live event is a line in place, apart from the step that shares its seq", () => {
		const live = play([
			[{ type: "text", seq: 6, text: "before" }, 1],
			[summary, 2],
			[trim, 3],
			[{ type: "text", seq: 9, text: "after" }, 4],
		]);
		const view = chatView([], live, null);
		expect(view.map((m) => [m.role, m.seq])).toEqual([
			["assistant", 6],
			["compaction", 7],
			["compaction", 9],
			["assistant", 9],
		]);
		expect(new Set(view.map(messageKey)).size).toBe(4);
		expect(view[1].compaction).toMatchObject({ kind: "summary", before: 102_000, after: 9000 });
	});
});

describe("the phase of a run", () => {
	test("call-start says the job was picked up, and writes no message of its own", () => {
		const live = play([[{ type: "call-start", seq: -1, at: 1000 }, 1000]]);
		expect(live).toMatchObject({ pickedUp: true, callStartAt: 1000 });
		expect(live.messages).toEqual([]);
	});

	test("reasoning-start says the call is thinking, at the time it began", () => {
		const live = play([[{ type: "reasoning-start", seq: 1, at: 5000 }, 5000]]);
		expect(live.reasoningStartedAt).toBe(5000);
		expect(live.messages).toEqual([]);
	});

	test("a tool result starts the next call: no thinking until it reasons again", () => {
		const live = play([
			[{ type: "reasoning-start", seq: 1, at: 1000 }, 1000],
			[
				{ type: "tool-end", seq: 2, toolCallId: "t", toolName: "get_route", status: "done" },
				9000,
			],
		]);
		expect(live.reasoningStartedAt).toBeUndefined();
		expect(live.callStartedAt).toBe(9000);
	});

	test("a provider that sends no reasoning-start still says thinking at its first token", () => {
		const live = play([
			[{ type: "call-start", seq: -1, at: 1000 }, 1000],
			[{ type: "reasoning", seq: 1, text: "hmm" }, 4000],
		]);
		expect(live.reasoningStartedAt).toBe(4000);
		// a later token does not move it
		expect(play([[{ type: "reasoning", seq: 1, text: " more" }, 7000]], live).reasoningStartedAt).toBe(
			4000,
		);
	});
});

describe("showsNothing", () => {
	const say = (role: "user" | "assistant", ...parts: ChatMessage["parts"]): ChatMessage => ({
		seq: 1,
		role,
		parts,
	});
	test("true while nothing new is on screen: no text, no tool still running", () => {
		expect(showsNothing([])).toBe(true);
		expect(showsNothing([say("user", { type: "text", text: "build it" })])).toBe(true);
		// reasoning with nothing else is still thinking: the label belongs there
		expect(showsNothing([say("assistant", { type: "reasoning", text: "hmm" })])).toBe(true);
	});
	test("false while a tool runs, and once the model answers", () => {
		// a call that has not come back yet is the thing on screen
		expect(
			showsNothing([say("assistant", { type: "tool", id: "t", name: "get_route", input: {} })]),
		).toBe(false);
		expect(showsNothing([say("assistant", { type: "text", text: "here you go" })])).toBe(false);
		// its result is in: the model is being asked again, with nothing new on screen
		expect(
			showsNothing([
				say("assistant", { type: "tool", id: "t", name: "get_route", input: {}, status: "done" }),
			]),
		).toBe(true);
	});
});

describe("phaseOf", () => {
	const at = { pickedUp: false, queuedAt: 100 };
	test("queued until the job is picked up, by the stream or by the run row", () => {
		expect(phaseOf(EMPTY_LIVE, at)).toEqual({ phase: "queued", since: 100 });
		expect(phaseOf(EMPTY_LIVE, { ...at, pickedUp: true })).toEqual({ phase: "waiting", since: 100 });
		expect(phaseOf({ ...EMPTY_LIVE, pickedUp: true, callStartAt: 500 }, at)).toEqual({
			phase: "waiting",
			since: 500,
		});
	});

	test("thinking needs a reasoning event of the call in progress, and times from it", () => {
		const live = { ...EMPTY_LIVE, pickedUp: true, callStartAt: 500, reasoningStartedAt: 900 };
		expect(phaseOf(live, at)).toEqual({ phase: "thinking", since: 900 });
		// the next call began at the last tool result: its wait is timed from there
		expect(phaseOf({ ...live, reasoningStartedAt: undefined, callStartedAt: 800 }, at)).toEqual({
			phase: "waiting",
			since: 800,
		});
	});
});

const row = (seq: number, role: string, content: unknown, createdAt?: string): AgentRow => ({
	seq,
	role,
	runId: "r1",
	content,
	createdAt,
});

describe("saved rows", () => {
	test("a summary row is a compaction line with its stats and its text", () => {
		const stats = { type: "compaction", kind: "summary", messages: 5, coversUpTo: 5, before: 102_000, after: 9000 };
		const rows = [
			row(0, "user", { role: "user", content: "hi" }),
			row(1, "summary", { role: "user", content: "Summary of the earlier conversation:\nbuilt a route", compaction: stats }),
			row(2, "summary", { role: "user", content: "Summary of the earlier conversation:\nold" }),
		];
		const [, withStats, old] = toMessages(rows);
		expect(withStats).toMatchObject({ role: "compaction", seq: 1, compaction: stats });
		expect(withStats.summary).toContain("built a route");
		// a summary from before the stats were kept still shows
		expect(old).toMatchObject({ role: "compaction", seq: 2, compaction: undefined });
	});

	test("a trim line saved on a step shows before that step, with its stats", () => {
		const stats = { type: "compaction" as const, kind: "trim" as const, results: 3, tools: { get_recording: 3 }, before: 41_000, after: 12_000 };
		const rows = [
			row(0, "user", { role: "user", content: "go" }),
			row(1, "assistant", { role: "assistant", content: [{ type: "text", text: "ok" }], compaction: stats }),
		];
		const view = toMessages(rows);
		expect(view.map((m) => [m.role, m.seq])).toEqual([
			["user", 0],
			["compaction", 1],
			["assistant", 1],
		]);
		expect(view[1].compaction).toEqual(stats);
		expect(new Set(view.map(messageKey)).size).toBe(3);
	});

	test("the live trim line gives way to the saved one, so the line stays after the run", () => {
		const stats = { type: "compaction" as const, kind: "trim" as const, results: 3, tools: { get_route: 3 }, before: 41_000, after: 12_000 };
		const live = play([
			[{ type: "compaction", seq: 1, compaction: stats }, 1],
			[{ type: "text", seq: 1, text: "ok" }, 2],
		]);
		expect(chatView([row(0, "user", { role: "user", content: "go" })], live, null).filter((m) => m.role === "compaction")).toHaveLength(1);
		const saved = [
			row(0, "user", { role: "user", content: "go" }),
			row(1, "assistant", { role: "assistant", content: [{ type: "text", text: "ok" }], compaction: stats }),
		];
		const view = chatView(saved, live, null);
		expect(view.map((m) => [m.role, m.seq])).toEqual([["user", 0], ["compaction", 1], ["assistant", 1]]);
	});

	test("a step that only thought and called tools keeps the time it took; one with an answer does not", () => {
		const think = [{ type: "reasoning", text: "hmm" }];
		const call = { type: "tool-call", toolCallId: "t", toolName: "get_route", input: {} };
		const rows = [
			row(0, "user", { role: "user", content: "go" }, "2026-10-09T10:00:00.000Z"),
			row(1, "assistant", { role: "assistant", content: [...think, call] }, "2026-10-09T10:00:42.000Z"),
			row(2, "tool", { role: "tool", content: [] }, "2026-10-09T10:00:43.000Z"),
			row(3, "assistant", { role: "assistant", content: [...think, { type: "text", text: "done" }] }, "2026-10-09T10:01:00.000Z"),
		];
		const [, first, second] = toMessages(rows);
		expect(first.parts[0]).toMatchObject({ type: "reasoning", ms: 42_000 });
		expect((second.parts[0] as { ms?: number }).ms).toBeUndefined();
	});

	test("without timestamps, or without the row before, there is no time", () => {
		const think = { role: "assistant", content: [{ type: "reasoning", text: "hmm" }] };
		expect((toMessages([row(1, "assistant", think)])[0].parts[0] as { ms?: number }).ms).toBeUndefined();
		expect(
			(toMessages([row(1, "assistant", think, "2026-10-09T10:00:00.000Z")])[0].parts[0] as { ms?: number }).ms,
		).toBeUndefined();
	});

});
