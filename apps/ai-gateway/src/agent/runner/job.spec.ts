import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { json, scripted } from "../resume.fixture";
import { pendingCalls } from "../resume";
import type { AgentStore, RunStatus } from "../store";
import type { AgentEvent } from "./events";
import { executeRun, type RunDeps } from "./job";
import type { AgentJob } from "./queue";

/** A run's world in memory: saved rows, run status, conversation status, published batches. */
function world(script: string[][]) {
	const rows: { seq: number; content: ModelMessage }[] = [];
	const state = { run: "queued" as RunStatus, settled: [] as RunStatus[] };
	const sent: AgentEvent[][] = [];
	const store = {
		append: async (_c: string, _r: string, list: ModelMessage[]) =>
			list.map((m) => rows.push({ seq: rows.length, content: json(m) }) - 1),
		appendSummary: async () => {
			throw new Error("no summaries here");
		},
		modelView: async () => rows.map((r) => ({ message: json(r.content), seq: r.seq })),
		setRunStatus: async (_r: string, s: RunStatus) => {
			state.run = s;
		},
	} as unknown as AgentStore;
	const m = scripted(script);
	const deps: RunDeps = {
		store,
		claimRun: async () => {
			if (state.run !== "queued") return false;
			state.run = "executing";
			return true;
		},
		settle: async (_c, _r, s) => void state.settled.push(s),
		build: async () => {
			const { approve: _, ...agent } = m.agent;
			return agent;
		},
		publish: async (_r, e) => void sent.push(structuredClone(e)),
		batchMs: 5,
	};
	const events = () => sent.flat();
	return { rows, state, deps, m, events };
}

const job = (over: Partial<AgentJob> = {}): AgentJob => ({
	type: "start",
	conversationId: "c",
	runId: "r",
	userId: "u",
	projectId: "p",
	mode: "manual",
	message: "build it",
	...over,
});
const go = (w: ReturnType<typeof world>, j: AgentJob, signal = new AbortController().signal) =>
	executeRun(j, w.deps, signal);

describe("executeRun", () => {
	it("start: a change waits for approval, the job ends after the approval event", async () => {
		const w = world([["save_route"]]);
		expect(await go(w, job())).toBe("waiting_approval");
		expect(w.m.ran).toEqual([]);
		expect(w.state.settled).toEqual(["waiting_approval"]);
		const ev = w.events();
		expect(ev.map((e) => e.type)).toEqual(["tool-start", "approval", "done"]);
		// the assistant message holding the call is row 1, after the user message
		expect(ev[1]).toMatchObject({ type: "approval", seq: 1, toolName: "save_route", isDelete: false });
		expect(ev.at(-1)).toEqual({ type: "done", seq: 1, status: "waiting_approval" });
		expect(w.rows.map((r) => r.content.role)).toEqual(["user", "assistant"]);
	});

	it("a duplicate delivery is skipped before any work", async () => {
		const w = world([]);
		w.state.run = "executing";
		expect(await go(w, job())).toBe("skipped");
		expect(w.events()).toEqual([]);
	});

	it("continue: approving runs the call and the run completes; text is tagged with its message", async () => {
		const w = world([["save_route"]]);
		await go(w, job());
		w.state.run = "queued"; // what the approval endpoint does
		expect(await go(w, job({ type: "continue", message: undefined, approval: { ok: true } }))).toBe(
			"completed",
		);
		expect(w.m.ran).toEqual(["save_route"]);
		// rows: user 0, assistant 1, tool 2, final assistant 3
		const text = w.events().filter((e) => e.type === "text");
		expect(text).toEqual([{ type: "text", seq: 3, text: "done" }]);
		expect(w.events().at(-1)).toEqual({ type: "done", seq: 3, status: "completed" });
	});

	it("continue: rejecting stores the denial and the model goes on", async () => {
		const w = world([["save_route"]]);
		await go(w, job());
		w.state.run = "queued";
		const status = await go(
			w,
			job({ type: "continue", message: undefined, approval: { ok: false, reason: "not now" } }),
		);
		expect(status).toBe("completed");
		expect(w.m.ran).toEqual([]);
		expect(JSON.stringify(w.rows[2].content)).toContain("not now");
	});

	it("stop: an aborted run is interrupted and leaves no call waiting", async () => {
		const w = world([["get_route"], ["get_route"], ["get_route"]]);
		const ctrl = new AbortController();
		const run = go(w, job({ mode: "auto" }), ctrl.signal);
		ctrl.abort(new Error("Stopped by user"));
		expect(await run).toBe("interrupted");
		expect(w.state.settled).toEqual(["interrupted"]);
		expect(pendingCalls(w.rows.map((r) => r.content))).toEqual([]);
		expect(w.events().at(-1)).toMatchObject({ type: "done", status: "interrupted" });
	});

	it("a run that cannot start fails with an error event", async () => {
		const w = world([]);
		w.deps.build = async () => {
			throw new Error("This project has no AI integration for the agent.");
		};
		expect(await go(w, job())).toBe("failed");
		expect(w.state.run).toBe("failed");
		expect(w.state.settled).toEqual(["failed"]);
		expect(w.events()).toEqual([
			{ type: "error", seq: -1, message: "This project has no AI integration for the agent." },
		]);
	});
});
