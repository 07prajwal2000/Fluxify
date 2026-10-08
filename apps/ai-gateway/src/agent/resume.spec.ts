import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { runAgent } from "./agent";
import { SUMMARY_HEAD } from "./compact";
import { json, scripted, step } from "./resume.fixture";
import { continueConversation, pendingCalls } from "./resume";
import type { AgentStore } from "./store";

type Row = { seq: number; role: string; content: ModelMessage; coversUpToSeq?: number };

/** In memory: seqs in order; the view is every non-summary row (store.test.ts covers the real one). */
function memStore() {
	const rows: Row[] = [];
	const statuses: string[] = [];
	const add = (role: string, content: ModelMessage, coversUpToSeq?: number) => {
		rows.push({ seq: rows.length, role, content: json(content), coversUpToSeq });
		return rows.length - 1;
	};
	const store = {
		append: async (_c: string, _r: string, list: ModelMessage[]) => list.map((m) => add(m.role, m)),
		appendSummary: async (_c: string, _r: string, s: ModelMessage, covers: number) =>
			add("summary", s, covers),
		modelView: async () =>
			rows.filter((r) => r.role !== "summary").map((r) => ({ message: json(r.content), seq: r.seq })),
		setRunStatus: async (_r: string, s: string) => {
			statuses.push(s);
		},
	} as unknown as AgentStore;
	return { rows, statuses, store };
}

const turn = async (
	s: ReturnType<typeof memStore>,
	agent: ReturnType<typeof scripted>["agent"],
	input: { message?: string; approval?: { ok: true } | { ok: false; reason?: string } },
) => {
	const r = await continueConversation({ store: s.store, conversationId: "c", runId: "r", agent, ...input });
	return r.status;
};

describe("approval wait", () => {
	it("a deferred approval saves waiting_approval and stops before the tool runs", async () => {
		const s = memStore();
		const m = scripted([["save_route"]]);
		expect(await turn(s, m.agent, { message: "build it" })).toBe("waiting_approval");
		expect(m.ran).toEqual([]);
		expect(m.prompts).toHaveLength(1);
		expect(s.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
		expect(s.statuses).toEqual(["executing", "waiting_approval"]);
		expect(pendingCalls(s.rows.map((r) => r.content)).map((c) => c.toolName)).toEqual(["save_route"]);
	});

	it("approving runs the call, stores its result and goes on", async () => {
		const s = memStore();
		const m = scripted([["save_route"]]);
		await turn(s, m.agent, { message: "build it" });
		expect(await turn(s, m.agent, { approval: { ok: true } })).toBe("completed");
		expect(m.ran).toEqual(["save_route"]);
		const sent = m.prompts[1];
		expect(sent.at(-1)?.role).toBe("tool");
		expect(JSON.stringify(sent.at(-1))).toContain('"ok"');
		expect(s.rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
	});

	it("rejecting tells the model why and goes on without the call", async () => {
		const s = memStore();
		const m = scripted([["save_route"]]);
		await turn(s, m.agent, { message: "build it" });
		expect(await turn(s, m.agent, { approval: { ok: false, reason: "use /v2" } })).toBe("completed");
		expect(m.ran).toEqual([]);
		expect(JSON.stringify(m.prompts[1].at(-1))).toContain(
			"The user did not approve save_route: use /v2.",
		);
	});

	it("waits for every pending call before calling the model again", async () => {
		const s = memStore();
		const m = scripted([["save_route", "save_route"]]);
		await turn(s, m.agent, { message: "build two" });
		expect(await turn(s, m.agent, { approval: { ok: true } })).toBe("waiting_approval");
		expect(m.prompts).toHaveLength(1);
		expect(await turn(s, m.agent, { approval: { ok: true } })).toBe("completed");
		expect(m.ran).toEqual(["save_route", "save_route"]);
	});

	it("refuses a new message while a call waits", async () => {
		const s = memStore();
		const m = scripted([["save_route"]]);
		await turn(s, m.agent, { message: "build it" });
		expect(turn(s, m.agent, { message: "hello?" })).rejects.toThrow("waiting for an approval");
	});
});

describe("summary rows", () => {
	it("a summary is stored once, covering up to the last summarized row, and the model gets it", async () => {
		const s = memStore();
		await s.store.append("c", "r", [{ role: "user", content: "build" }, ...step(1), ...step(2)]);
		await s.store.append("c", "r", [{ role: "assistant", content: "built" }]);
		const m = scripted([], undefined, 1000);
		await turn(s, m.agent, { message: "now test it" });
		const summary = s.rows.find((r) => r.role === "summary")!;
		// rows 0..5 are covered; row 6 is the new user message, kept verbatim
		expect(summary.coversUpToSeq).toBe(5);
		expect(String(summary.content.content)).toStartWith(SUMMARY_HEAD);
		expect(m.prompts[0].map((p) => p.role)).toEqual(["system", "user", "user"]);
		expect(s.rows.slice(0, 7).map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});
});

describe("persistence hooks", () => {
	it("report each finished message once, in order, and change nothing about the run", async () => {
		const run = async (hooked: boolean) => {
			const m = scripted([["get_route"], ["get_route"]], async () => ({ ok: true }));
			const history: ModelMessage[] = [{ role: "user", content: "go" }];
			const seen: ModelMessage[] = [];
			const r = runAgent({
				...m.agent,
				history,
				...(hooked && { onMessages: async (list: ModelMessage[]) => void seen.push(...list) }),
			});
			await r.consumeStream();
			return { history, seen };
		};
		const plain = await run(false);
		const hooked = await run(true);
		expect(json(hooked.history)).toEqual(json(plain.history));
		expect(hooked.seen).toEqual(hooked.history.slice(1));
		expect(plain.seen).toEqual([]);
	});
});
