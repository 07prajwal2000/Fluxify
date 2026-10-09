import { afterEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { continueConversation } from "./resume";
import { scripted } from "./resume.fixture";
import type { AgentStore } from "./store";
import { disableTelemetry } from "./telemetry";
import { collect, kind } from "./telemetry.fixture";

afterEach(disableTelemetry);

/** Just enough store to replay a conversation: the stored messages in order. */
function memStore() {
	const rows: ModelMessage[] = [];
	return {
		append: async (_c: string, _r: string, list: ModelMessage[]) => list.map((m) => rows.push(m) - 1),
		appendSummary: async () => rows.length,
		modelView: async () => rows.map((message, seq) => ({ message: structuredClone(message), seq })),
		setRunStatus: async () => {},
	} as unknown as AgentStore;
}

/** A deferred save_route, then the user's answer to it. */
async function answered(approval: { ok: true } | { ok: false; reason: string }) {
	const store = memStore();
	const m = scripted([["save_route"]]);
	const o = { store, conversationId: "conv", runId: "run", agent: m.agent };
	await (await continueConversation({ ...o, message: "build it" })).status;
	await (await continueConversation({ ...o, approval })).status;
}

describe("tool calls decided after a deferred approval (#719)", () => {
	it("an approved call is a tool span with the outcome, tagged with the conversation", async () => {
		const t = collect(true);
		await answered({ ok: true });
		const tools = t.named("execute_tool").filter((s) => s.attributes["fluxify.approval"] === "approved");
		expect(tools).toHaveLength(1);
		expect(kind(tools[0])).toBe("TOOL");
		expect(tools[0].attributes["tool.name"]).toBe("save_route");
		expect(tools[0].attributes["output.value"]).toBe("ok");
		expect(tools[0].attributes["session.id"]).toBe("conv");
		expect(JSON.parse(String(tools[0].attributes.metadata))).toMatchObject({ runId: "run", conversationId: "conv" });
	});

	it("a rejected call is a tool span marked denied", async () => {
		const t = collect(true);
		await answered({ ok: false, reason: "use /v2" });
		const tools = t.named("execute_tool").filter((s) => s.attributes["fluxify.approval"] === "denied");
		expect(tools.map((s) => s.attributes["tool.name"])).toEqual(["save_route"]);
	});

	it("without content recording the span keeps the name and drops input and output", async () => {
		const t = collect(false);
		await answered({ ok: true });
		const [tool] = t.named("execute_tool").filter((s) => s.attributes["fluxify.approval"] === "approved");
		expect(Object.keys(tool.attributes).filter((k) => /^(input|output)\./.test(k))).toEqual([]);
	});
});
