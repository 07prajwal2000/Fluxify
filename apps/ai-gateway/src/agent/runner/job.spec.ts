import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { AdminFetch } from "../../mcp/adminApi";
import { json, scripted } from "../resume.fixture";
import { pendingCalls } from "../resume";
import type { AgentStore, RunStatus } from "../store";
import { agentTools, loadedTools } from "../tools";
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
		all: async () => rows.map((r) => ({ seq: r.seq, role: r.content.role, content: json(r.content) })),
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

describe("loaded tools across jobs", () => {
	/** A model that calls `steps[i]` at step i (then answers), and records which tools each step could call. */
	function model(steps: { toolName: string; input: object }[]) {
		const offered: string[][] = [];
		const finish = (reason: string) => ({
			type: "finish",
			finishReason: { unified: reason, raw: reason },
			usage: {
				inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 1, text: 1, reasoning: 0 },
			},
		});
		const m = new MockLanguageModelV4({
			doStream: async (call) => {
				offered.push((call.tools ?? []).map((t) => t.name));
				const s = steps[offered.length - 1];
				const parts = s
					? [
							{ type: "tool-call", toolCallId: `c${offered.length}`, toolName: s.toolName, input: JSON.stringify(s.input) },
							finish("tool-calls"),
						]
					: [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "done" }, { type: "text-end", id: "t" }, finish("stop")];
				return { stream: convertArrayToReadableStream(parts as never[]) };
			},
		});
		return { m, offered };
	}

	it("load_tools, an approval wait, approve: the loaded tool runs, stays active and runs again", async () => {
		const w = world([]);
		const install = { projectId: "p", packages: [{ name: "zod" }] };
		const { m, offered } = model([
			{ toolName: "load_tools", input: { names: ["install_package", "list_members"] } },
			{ toolName: "install_package", input: install },
			{ toolName: "list_members", input: { projectId: "p" } },
		]);
		const fetched: string[] = [];
		const fetcher: AdminFetch = async (path) => {
			fetched.push(path.split("?")[0]);
			return Response.json(path.includes("install") ? { packages: [] } : { data: [] });
		};
		w.deps.build = async (_job, loaded) => {
			// a fresh tool set per job, as the worker builds it
			const { tools, active } = agentTools(fetcher, {}, "p", loaded);
			const { approve: _, tools: __, active: ___, model: ____, ...rest } = w.m.agent;
			return { ...rest, model: m, tools, active };
		};
		expect(await go(w, job())).toBe("waiting_approval");
		expect(fetched).toEqual([]);
		w.state.run = "queued";
		expect(await go(w, job({ type: "continue", message: undefined, approval: { ok: true } }))).toBe(
			"completed",
		);
		// the approved loaded call ran on resume; the next step still had list_members and called it
		expect(fetched).toEqual([
			"/_/admin/api/v1/projects/p/settings/packages/install",
			"/_/admin/api/v1/projects/p/settings/members/list",
		]);
		expect(offered[2]).toContain("list_members");
		expect(offered[2]).toContain("install_package");
	});

	it("rebuilds the set from saved load_tools calls only, dropping unknown names", () => {
		const call = (names: unknown) => ({
			role: "assistant" as const,
			content: [{ type: "tool-call" as const, toolCallId: "x", toolName: "load_tools", input: { names } }],
		});
		expect([...loadedTools([call(["list_members", "nope"]), call("bad"), call(["delete_route"])])]).toEqual([
			"list_members",
			"delete_route",
		]);
	});
});
