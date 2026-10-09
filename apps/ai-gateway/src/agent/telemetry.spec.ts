import { afterEach, describe, expect, it } from "bun:test";
import { OpenInferenceBatchSpanProcessor } from "@arizeai/openinference-vercel";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { MockLanguageModelV4 } from "ai/test";
import { summarize } from "./compact";
import { run } from "./guards.fixture";
import {
	disableTelemetry,
	parseHeaders,
	setupTelemetry,
	telemetryFor,
	traceConfig,
} from "./telemetry";
import { collect, kind } from "./telemetry.fixture";

afterEach(disableTelemetry);

const keys = (spans: ReadableSpan[]) => spans.flatMap((s) => Object.keys(s.attributes));

describe("tracing settings", () => {
	const on = {
		LLM_TRACING_ENABLED: "true",
		LLM_OTLP_TRACES_ENDPOINT: "http://phoenix:6006/v1/traces",
	};

	it("is off unless enabled with an endpoint", () => {
		expect(traceConfig({})).toBeNull();
		expect(traceConfig({ ...on, LLM_TRACING_ENABLED: "false" })).toBeNull();
		expect(traceConfig({ ...on, LLM_OTLP_TRACES_ENDPOINT: " " })).toBeNull();
	});

	it("defaults to full sampling and no content", () => {
		expect(traceConfig(on)).toEqual({
			endpoint: "http://phoenix:6006/v1/traces",
			headers: {},
			sampleRate: 1,
			recordContent: false,
		});
	});

	it("reads headers, sample rate and the content flag", () => {
		const c = traceConfig({
			...on,
			LLM_OTLP_TRACES_HEADERS: "Authorization: Bearer a:b ; x-key:1;bad;:no",
			LLM_TRACING_SAMPLE_RATE: "0.25",
			LLM_TRACING_RECORD_CONTENT: "TRUE",
		});
		expect(c?.headers).toEqual({ Authorization: "Bearer a:b", "x-key": "1" });
		expect(c?.sampleRate).toBe(0.25);
		expect(c?.recordContent).toBe(true);
	});

	it("keeps the sample rate between 0 and 1", () => {
		expect(traceConfig({ ...on, LLM_TRACING_SAMPLE_RATE: "7" })?.sampleRate).toBe(1);
		expect(traceConfig({ ...on, LLM_TRACING_SAMPLE_RATE: "-1" })?.sampleRate).toBe(0);
		expect(traceConfig({ ...on, LLM_TRACING_SAMPLE_RATE: "abc" })?.sampleRate).toBe(1);
		expect(parseHeaders(undefined)).toEqual({});
	});
});

describe("setup", () => {
	it("off: builds no provider and the SDK is told not to trace", () => {
		let built = 0;
		setupTelemetry({}, (() => ++built) as never);
		expect(built).toBe(0);
		expect(telemetryFor("fluxify.agent")).toEqual({ isEnabled: false });
	});

	it("on: wires the exporter processor with the endpoint, headers and sample rate", () => {
		const calls: any[] = [];
		const provider = new NodeTracerProvider();
		setupTelemetry(
			{
				LLM_TRACING_ENABLED: "true",
				LLM_OTLP_TRACES_ENDPOINT: "http://phoenix:6006/v1/traces",
				LLM_OTLP_TRACES_HEADERS: "Authorization:Bearer k",
				LLM_TRACING_SAMPLE_RATE: "0.5",
			},
			((o: any) => {
				calls.push(o);
				return provider;
			}) as never,
		);
		expect(calls).toHaveLength(1);
		const o = calls[0];
		expect(o.serviceName).toBe("fluxify.ai-gateway.llm");
		expect(o.endpoint).toBe("http://phoenix:6006/v1/traces");
		expect(o.headers).toEqual({ Authorization: "Bearer k" });
		expect(o.sampleRate).toBe(0.5);
		expect(o.processor(new InMemorySpanExporter())).toBeInstanceOf(OpenInferenceBatchSpanProcessor);
		expect(telemetryFor("fluxify.agent")).toMatchObject({
			isEnabled: true,
			functionId: "fluxify.agent",
			recordInputs: false,
			recordOutputs: false,
		});
		// a second call does nothing
		setupTelemetry({ LLM_TRACING_ENABLED: "true", LLM_OTLP_TRACES_ENDPOINT: "x" }, (() => {
			throw new Error("built twice");
		}) as never);
	});

	it("off: a run creates no spans", async () => {
		const r = await run([{ a: 1 }]);
		expect(r.results).toHaveLength(1);
	});
});

describe("spans", () => {
	it("a run is run → model steps → tool calls, with AGENT / LLM / TOOL kinds", async () => {
		const t = collect(true);
		await run([{ a: 1 }], { cacheRead: 3, trace: { conversationId: "conv1", runId: "run1" } });
		const [root] = t.named("fluxify.agent.run");
		expect(kind(root)).toBe("AGENT");
		expect(root.parentSpanId).toBeUndefined();
		const sdkRoot = t.named("invoke_agent")[0];
		expect(sdkRoot.parentSpanId).toBe(root.spanContext().spanId);
		const chats = t.named("chat");
		expect(chats).toHaveLength(2);
		for (const c of chats) expect(kind(c)).toBe("LLM");
		const [tool] = t.named("execute_tool");
		expect(kind(tool)).toBe("TOOL");
		expect(tool.attributes["tool.name"]).toBe("get_canvas");
		// one trace
		expect(new Set(t.spans().map((s) => s.spanContext().traceId)).size).toBe(1);
		// tokens, cache counts, finish reason
		expect(chats[0].attributes["llm.token_count.prompt"]).toBe(1);
		expect(chats[0].attributes["llm.token_count.prompt_details.cache_read"]).toBe(3);
		expect(chats[0].attributes["llm.finish_reason"]).toBe("tool-calls");
		expect(chats[1].attributes["llm.finish_reason"]).toBe("stop");
	});

	it("tags every span with the session and run metadata", async () => {
		const t = collect(true);
		await run([{ a: 1 }], { trace: { conversationId: "conv1", runId: "run1" } });
		const spans = t.spans();
		expect(spans.length).toBeGreaterThan(4);
		for (const s of spans) {
			expect(s.attributes["session.id"]).toBe("conv1");
			const meta = JSON.parse(String(s.attributes.metadata));
			expect(meta).toMatchObject({ conversationId: "conv1", runId: "run1", projectId: "p", mode: "auto" });
		}
	});

	it("the run records the user message, model, mode and how it ended", async () => {
		const t = collect(true);
		await run([{ a: 1 }]);
		const [root] = t.named("fluxify.agent.run");
		expect(root.attributes["input.value"]).toBe("go");
		expect(root.attributes["fluxify.mode"]).toBe("auto");
		expect(String(root.attributes["llm.model_name"])).toContain("mock-model-id");
		expect(root.attributes["fluxify.status"]).toBe("completed");
		expect(root.attributes["fluxify.finish_reason"]).toBe("stop");
	});

	it("a limit stop is the run's stop reason", async () => {
		const t = collect(true);
		await run([{ a: 1 }, { a: 2 }, { a: 3 }], { maxSteps: 2, onLimit: () => false });
		const [root] = t.named("fluxify.agent.run");
		expect(root.attributes["fluxify.status"]).toBe("stopped");
		expect(root.attributes["fluxify.stop_reason"]).toBe("steps");
	});

	it("a failing tool shows its error on the tool span", async () => {
		const t = collect(true);
		await run([{ a: 1 }], { fail: "boom" });
		const [tool] = t.named("execute_tool");
		expect(JSON.stringify(tool.events)).toContain("boom");
		expect(tool.status.code).toBe(2);
	});
});

describe("approval", () => {
	it("an approved call says so on its tool span, an unasked one says auto", async () => {
		const t = collect(true);
		await run(
			[
				["get_canvas", { a: 1 }],
				["edit_canvas", { a: 2 }],
			],
			{ mode: "manual", approve: async () => ({ ok: true }) },
		);
		const tools = t.named("execute_tool");
		expect(tools.map((s) => [s.attributes["tool.name"], s.attributes["fluxify.approval"]])).toEqual([
			["get_canvas", "auto"],
			["edit_canvas", "approved"],
		]);
	});

	it("'always' is told apart from a single yes", async () => {
		const t = collect(true);
		await run([["edit_canvas", { a: 1 }]], { mode: "manual", approve: async () => ({ ok: true, always: true }) });
		expect(t.named("execute_tool")[0].attributes["fluxify.approval"]).toBe("always");
	});

	it("a turned-down call gets a tool span of its own, with the outcome", async () => {
		const t = collect(true);
		await run([["edit_canvas", { a: 1 }]], { mode: "manual", approve: async () => ({ ok: false, reason: "no" }) });
		expect(t.named("execute_tool").map((s) => s.attributes["fluxify.approval"])).toEqual(["denied"]);
		const [denied] = t.named("execute_tool");
		expect(kind(denied)).toBe("TOOL");
		const [root] = t.named("fluxify.agent.run");
		expect(denied.parentSpanId).toBe(root.spanContext().spanId);
	});
});

describe("content flag", () => {
	const CONTENT = /^(input\.value|output\.value|llm\.input_messages\.|llm\.output_messages\.|gen_ai\.(input|output)\.|gen_ai\.system_instructions|gen_ai\.tool\.call\.(arguments|result)|tool\.parameters)/;

	it("true: prompts, tool inputs and outputs are in the spans", async () => {
		const t = collect(true);
		await run([{ secret: "hunter2" }], { respond: () => "the-result" });
		const all = JSON.stringify(t.spans().map((s) => s.attributes));
		expect(all).toContain("hunter2");
		expect(all).toContain("the-result");
		expect(all).toContain("Fluxify agent");
	});

	it("false: no messages, inputs or outputs; metadata and tokens stay", async () => {
		const t = collect(false);
		await run([{ secret: "hunter2" }], {
			cacheRead: 3,
			respond: () => "the-result",
			trace: { conversationId: "conv1", runId: "run1" },
		});
		expect(keys(t.spans()).filter((k) => CONTENT.test(k))).toEqual([]);
		const all = JSON.stringify(t.spans().map((s) => s.attributes));
		for (const text of ["hunter2", "the-result", "Fluxify agent", '"go"']) expect(all).not.toContain(text);
		const [tool] = t.named("execute_tool");
		expect(tool.attributes["tool.name"]).toBe("get_canvas");
		expect(tool.attributes["fluxify.approval"]).toBe("auto");
		const [chat] = t.named("chat");
		expect(chat.attributes["llm.token_count.prompt"]).toBe(1);
		expect(chat.attributes["llm.token_count.prompt_details.cache_read"]).toBe(3);
		expect(chat.attributes["llm.finish_reason"]).toBe("tool-calls");
		expect(JSON.parse(String(chat.attributes.metadata)).runId).toBe("run1");
	});

	it("false: a turned-down call keeps its name but not its input", async () => {
		const t = collect(false);
		await run([["edit_canvas", { secret: "hunter2" }]], { mode: "manual", approve: async () => ({ ok: false }) });
		const [denied] = t.named("execute_tool");
		expect(denied.attributes["tool.name"]).toBe("edit_canvas");
		expect(JSON.stringify(denied.attributes)).not.toContain("hunter2");
	});
});

describe("compaction", () => {
	const usage = {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	};
	const model = new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text: "the summary" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage,
			warnings: [],
		}),
	});
	const call = (id: string) => [
		{ role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: id, toolName: "get_route", input: {} }] },
		{
			role: "tool" as const,
			content: [{ type: "tool-result" as const, toolCallId: id, toolName: "get_route", output: { type: "json" as const, value: "ok" } }],
		},
	];
	const history = () => [
		{ role: "user" as const, content: "build it" },
		...["a", "b", "c", "d"].flatMap(call),
		{ role: "user" as const, content: "now test it" },
	];

	it("a summary is a span with the tokens before and after, around the summarizer call", async () => {
		const t = collect(true);
		const r = await summarize(model, history());
		const [span] = t.named("fluxify.compaction");
		expect(kind(span)).toBe("CHAIN");
		expect(span.attributes["fluxify.compaction.kind"]).toBe("summary");
		expect(span.attributes["fluxify.compaction.tokens_before"]).toBe(r?.event.before);
		expect(span.attributes["fluxify.compaction.tokens_after"]).toBe(r?.event.after);
		expect(t.named("invoke_agent")[0].parentSpanId).toBe(span.spanContext().spanId);
		expect(t.named("invoke_agent")[0].attributes["gen_ai.agent.name"]).toBe("fluxify.agent.compaction");
	});

	it("a failed summary marks the span failed", async () => {
		const t = collect(true);
		const bad = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new Error("no model");
			},
		});
		await expect(summarize(bad, history(), {})).rejects.toThrow();
		expect(t.named("fluxify.compaction")[0].status.code).toBe(2);
	});

	it("off: no spans and the summary still works", async () => {
		const r = await summarize(model, history());
		expect(r?.event.kind).toBe("summary");
	});
});
