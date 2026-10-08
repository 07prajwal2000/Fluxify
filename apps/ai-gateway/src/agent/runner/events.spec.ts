import { describe, expect, it } from "bun:test";
import type { AgentStore } from "../store";
import { type AgentEvent, batcher, seqTracker, toEvent, unseen } from "./events";

describe("batcher", () => {
	it("sends one batch per window, merging deltas of the same message", async () => {
		const sent: AgentEvent[][] = [];
		const b = batcher(async (e) => void sent.push(e), () => {}, 20);
		b.push({ type: "text", seq: 3, text: "Hel" });
		b.push({ type: "text", seq: 3, text: "lo" });
		b.push({ type: "reasoning", seq: 3, text: "hm" });
		b.push({ type: "text", seq: 5, text: "next" });
		expect(sent).toEqual([]);
		await Bun.sleep(40);
		expect(sent).toEqual([
			[
				{ type: "text", seq: 3, text: "Hello" },
				{ type: "reasoning", seq: 3, text: "hm" },
				{ type: "text", seq: 5, text: "next" },
			],
		]);
		b.push({ type: "done", seq: 5, status: "completed" });
		await b.flush();
		expect(sent).toHaveLength(2);
	});

	it("keeps batches in order and reports a failed publish", async () => {
		const sent: number[] = [];
		const errors: unknown[] = [];
		const b = batcher(
			async (e) => {
				if (e[0].seq === 1) throw new Error("nats down");
				await Bun.sleep(5);
				sent.push(e[0].seq);
			},
			(e) => errors.push(e),
			1000,
		);
		for (const seq of [0, 1, 2]) {
			b.push({ type: "text", seq, text: "x" });
			void b.flush();
		}
		await b.flush();
		expect(sent).toEqual([0, 2]);
		expect(errors).toHaveLength(1);
	});
});

describe("seq tagging", () => {
	const store = {
		append: async (_c: string, _r: string, list: unknown[]) => list.map((_, i) => 7 + i),
		appendSummary: async () => 9,
	} as unknown as AgentStore;

	it("follows saved seqs: a step's text and calls get the next seq, its results the one after", async () => {
		const { t, store: s } = seqTracker(store);
		await s.append("c", "r", [{ role: "user", content: "hi" }]);
		expect(t.next).toBe(8);
		const ev = (p: object) => toEvent(p as never, t);
		expect(ev({ type: "start-step" })).toBeUndefined();
		expect(ev({ type: "text-delta", text: "ok" })).toEqual({ type: "text", seq: 8, text: "ok" });
		expect(ev({ type: "tool-call", toolCallId: "a", toolName: "get_route", input: {} })).toMatchObject({
			type: "tool-start",
			seq: 8,
		});
		expect(
			ev({ type: "tool-result", toolCallId: "a", toolName: "get_route", output: "x".repeat(5000) }),
		).toMatchObject({ type: "tool-end", seq: 9, output: `${"x".repeat(4000)}…` });
		expect(
			ev({
				type: "tool-approval-request",
				toolCall: { toolCallId: "b", toolName: "delete_route", input: { id: 1 } },
			}),
		).toEqual({
			type: "approval",
			seq: 8,
			toolCallId: "b",
			toolName: "delete_route",
			input: { id: 1 },
			isDelete: true,
		});
		expect(ev({ type: "reasoning-delta", text: "" })).toBeUndefined();
		await s.appendSummary("c", "r", { role: "user", content: "s" }, 3);
		expect(t.next).toBe(10);
	});
});

describe("unseen", () => {
	it("drops events of messages the client loaded, never the end", () => {
		const events: AgentEvent[] = [
			{ type: "text", seq: 4, text: "a" },
			{ type: "text", seq: 5, text: "b" },
			{ type: "done", seq: 5, status: "completed" },
		];
		expect(unseen(events, 4).map((e) => e.seq)).toEqual([5, 5]);
		expect(unseen(events, 9).map((e) => e.type)).toEqual(["done"]);
	});
});
