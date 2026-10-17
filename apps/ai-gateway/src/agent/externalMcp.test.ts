// External MCP (#823): the real job path (executeRun + buildAgent + the real tools and MCP clients)
// against a real math server, with a scripted model. No Postgres or NATS: settings, the integration
// caches and the store are in memory.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";
import * as server from "@fluxify/server";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { type Approval, runAgent } from "./agent";
import { closeServers, openServers } from "./external";
import * as modelModule from "./model";
import { printRun } from "./progress";
import type { AgentEvent } from "./runner/events";
import { executeRun, type RunDeps } from "./runner/job";
import type { AgentJob } from "./runner/queue";
import { buildAgent } from "./runner/worker";
import type { AgentStore, RunStatus } from "./store";
import { agentTools } from "./tools";

const P = "019a0000-0000-7000-8000-000000000000";
let math: Awaited<ReturnType<typeof startMathMcp>>;
let other: Awaited<ReturnType<typeof startMathMcp>>;
let settings: Record<string, string>;
let scripted: ReturnType<typeof model>;
const spies: { mockRestore(): void }[] = [];

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET ??= "test-secret";
	[math, other] = await Promise.all([startMathMcp(), startMathMcp({ name: "other" })]);
});
afterAll(() => Promise.all([math.close(), other.close()]));

beforeEach(() => {
	math.calls.length = 0;
	other.calls.length = 0;
	settings = {
		"settings.ai.agentConnectionId": "ai1",
		"settings.ai.agentMcpIntegrations": "m1",
	};
	server.aiIntegrationsCache.ai1 = { __projectId: P } as never;
	server.mcpIntegrationsCache.m1 = { name: "math", url: math.url, headers: {}, __projectId: P };
	server.mcpIntegrationsCache.m2 = { name: "other", url: other.url, headers: {}, __projectId: P };
	spies.push(
		spyOn(server, "getProjectSetting").mockImplementation(async (_p, k) => settings[k] ?? ""),
		spyOn(modelModule, "modelFromIntegration").mockImplementation(() => scripted.m as never),
	);
});
afterEach(() => {
	for (const s of spies.splice(0)) s.mockRestore();
	for (const k of ["ai1", "m1", "m2"]) {
		delete server.aiIntegrationsCache[k];
		delete server.mcpIntegrationsCache[k];
	}
});

const finish = (reason: string) => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
});

/** A model that calls `steps[i]` at step i, then answers "done"; `offered` is what each step could call. */
function model(steps: { toolName: string; input: object }[]) {
	const offered: string[][] = [];
	const m = new MockLanguageModelV4({
		doStream: async (call) => {
			offered.push((call.tools ?? []).map((t) => t.name));
			const s = steps[offered.length - 1];
			const parts = s
				? [
						{
							type: "tool-call",
							toolCallId: `c${offered.length}`,
							toolName: s.toolName,
							input: JSON.stringify(s.input),
						},
						finish("tool-calls"),
					]
				: [
						{ type: "text-start", id: "t" },
						{ type: "text-delta", id: "t", delta: "done" },
						{ type: "text-end", id: "t" },
						finish("stop"),
					];
			return { stream: convertArrayToReadableStream(parts as never[]) };
		},
	});
	return { m, offered };
}

const load = { toolName: "load_tools", input: { names: ["ext_math__add", "ext_math__slow_add"] } };
const add = { toolName: "ext_math__add", input: { a: 2, b: 3 } };
const list = { toolName: "list_mcp_tools", input: {} };

/** A run's world in memory: saved rows, run status, and the real buildAgent (its `close` counted). */
function world() {
	const rows: { seq: number; content: ModelMessage }[] = [];
	const state = { run: "queued" as RunStatus, closed: 0 };
	const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
	const store = {
		append: async (_c: string, _r: string, l: ModelMessage[]) =>
			l.map((m) => rows.push({ seq: rows.length, content: json(m) }) - 1),
		appendSummary: async () => {
			throw new Error("no summaries here");
		},
		modelView: async () => rows.map((r) => ({ message: json(r.content), seq: r.seq })),
		all: async () =>
			rows.map((r) => ({ seq: r.seq, role: r.content.role, content: json(r.content) })),
		setRunStatus: async (_r: string, s: RunStatus) => {
			state.run = s;
		},
	} as unknown as AgentStore;
	const deps: RunDeps = {
		store,
		claimRun: async () => {
			if (state.run !== "queued") return false;
			state.run = "executing";
			return true;
		},
		settle: async () => {},
		build: async (j, loaded, todos) => {
			const agent = await buildAgent(j, loaded, todos);
			return {
				...agent,
				close: async () => {
					state.closed++;
					return agent.close?.();
				},
			};
		},
		publish: async (_r: string, _e: AgentEvent[]) => {},
		batchMs: 5,
	};
	return { rows, state, deps, text: () => JSON.stringify(rows) };
}

const job = (over: Partial<AgentJob> = {}): AgentJob => ({
	type: "start",
	conversationId: "c",
	runId: "r",
	userId: "u",
	projectId: P,
	mode: "auto",
	message: "add 2 and 3",
	...over,
});
const start = (
	w: ReturnType<typeof world>,
	over?: Partial<AgentJob>,
	signal = new AbortController().signal,
) => executeRun(job(over), w.deps, signal);
/** What the approval endpoint does: queue the run again, then the continue job. */
const answer = (
	w: ReturnType<typeof world>,
	approval: NonNullable<AgentJob["approval"]>,
	signal?: AbortSignal,
) => {
	w.state.run = "queued";
	return start(w, { type: "continue", message: undefined, approval }, signal);
};

describe("external MCP in the agent (#823)", () => {
	it("list, load, call in auto: the call waits, nothing ran; approved, it runs once and the result is 5", async () => {
		scripted = model([list, load, add]);
		const w = world();
		expect(await start(w)).toBe("waiting_approval");
		expect(math.calls).toEqual([]);
		expect(w.text()).toContain('"tools":6');
		expect(await answer(w, { ok: true })).toBe("completed");
		expect(math.calls).toEqual([{ tool: "add", args: { a: 2, b: 3 } }]);
		expect(w.text()).toContain('"result":5');
		expect(w.state.closed).toBe(2);
	});

	it("denied: the model gets the rejection and the server is never called", async () => {
		scripted = model([load, add]);
		const w = world();
		await start(w);
		expect(await answer(w, { ok: false, reason: "not now" })).toBe("completed");
		expect(math.calls).toEqual([]);
		expect(w.text()).toContain("The user did not approve ext_math__add: not now");
	});

	it("'always' never covers the next ext_ call", async () => {
		scripted = model([load, add, add]);
		const servers = await openServers([{ id: "m1", name: "math", url: math.url, headers: {} }]);
		try {
			const {
				tools,
				active,
				load: loadTool,
			} = agentTools(async () => Response.json({}), {}, P, new Set(), undefined, servers);
			const asked: string[] = [];
			const allowed = new Set<string>();
			const result = runAgent({
				model: scripted.m,
				tools,
				active,
				load: loadTool,
				projectId: P,
				history: [{ role: "user", content: "add twice" }],
				limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0 },
				mode: "auto",
				allowed,
				approve: async (c): Promise<Approval> => {
					asked.push(c.toolName);
					return { ok: true, always: true };
				},
			});
			await printRun(result, { write: () => {}, log: () => {} });
			expect(asked).toEqual(["ext_math__add", "ext_math__add"]);
			expect(allowed.size).toBe(0);
			expect(math.calls).toHaveLength(2);
		} finally {
			await closeServers(servers);
		}
	});

	it("@server preloads its tools: no load_tools needed", async () => {
		scripted = model([add]);
		const w = world();
		expect(await start(w, { mentions: ["m1"] })).toBe("waiting_approval");
		expect(scripted.offered[0]).toContain("ext_math__add");
		expect(math.calls).toEqual([]);
		expect(await answer(w, { ok: true })).toBe("completed");
		expect(math.calls).toHaveLength(1);
	});

	it("a server not in the setting is invisible, even when mentioned", async () => {
		scripted = model([list]);
		const w = world();
		expect(await start(w, { mentions: ["m2"] })).toBe("completed");
		expect(scripted.offered[0]).not.toContain("ext_other__add");
		expect(w.text()).toContain("math");
		expect(w.text()).not.toContain("other");
	});

	it("stopping during slow_add closes the clients and ends the run", async () => {
		scripted = model([load, { toolName: "ext_math__slow_add", input: { a: 1, b: 2, ms: 5000 } }]);
		const w = world();
		await start(w);
		expect(w.state.closed).toBe(1);
		const ctrl = new AbortController();
		const t = Date.now();
		const run = answer(w, { ok: true }, ctrl.signal);
		for (let i = 0; i < 50 && !math.calls.length; i++) await Bun.sleep(50);
		ctrl.abort(new Error("Stopped by user"));
		expect(await run).toBe("interrupted");
		expect(Date.now() - t).toBeLessThan(4000);
		expect(w.state.closed).toBe(2);
	});
});
