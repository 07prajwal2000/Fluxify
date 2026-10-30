import { afterAll, beforeAll, expect, it } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import {
	type BlockDTOType,
	BlockTypes,
	closeCtxIntegrations,
	compileGraph,
	registerModuleBlock,
	unregisterBlock,
	withCtxIntegrations,
} from "@fluxify/blocks";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { param } from "@fluxify/sdk/blocks";
import { type AiAdapter, integration } from "@fluxify/sdk/integrations";
import { grantContext, toStoredConfig, toVariantDef } from "@fluxify/sdk/runtime";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { RouteTraceRecorder } from "./routeRecorder";

/**
 * A plugin's AI variant (an OpenAI-compatible provider) against a local mock
 * server, used by a plugin block that runs `generateText` with a tool writing
 * to KV: the loop runs, the tool lands, and every model call is a span under
 * the block, with tokens and no prompt.
 */

const PROJECT = "proj-ai-plugin";
const TYPE = "acme/ai/remember";
const SECRET_PROMPT = "remember the colour blue";

const completion = (message: object, finish: string) => ({
	id: "c",
	object: "chat.completion",
	created: 0,
	model: "tiny",
	choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
	usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
});

const seen: { auth: string | null; model: string }[] = [];
let server: ReturnType<typeof Bun.serve>;
const llm = integration({
	name: "acme/ai/tiny",
	label: "Tiny",
	icon: "./tiny.svg",
	group: "ai",
	variant: "Tiny",
	config: { baseUrl: param.string({ required: true }), key: param.secret({ required: true }) },
	connect(config, ctx): AiAdapter {
		const provider = createOpenAICompatible({
			name: "tiny",
			baseURL: config.baseUrl,
			apiKey: ctx.getConfig(config.key),
		});
		return { languageModel: (id = "tiny") => provider.languageModel(id) };
	},
});
const variant = toVariantDef(llm);
let resolved: Record<string, unknown>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = (await req.json()) as { model: string; messages: { role: string }[] };
			seen.push({ auth: req.headers.get("authorization"), model: body.model });
			// first turn calls the tool, the turn after its result answers
			if (!body.messages.some((m) => m.role === "tool"))
				return Response.json(
					completion(
						{
							content: null,
							tool_calls: [
								{ id: "t1", type: "function", function: { name: "remember", arguments: '{"value":"blue"}' } },
							],
						},
						"tool_calls",
					),
				);
			return Response.json(completion({ content: "done" }, "stop"));
		},
	});
	integrationRegistry.register(variant);
	const stored = toStoredConfig(llm, { baseUrl: `http://127.0.0.1:${server.port}/v1`, key: "LLM_KEY" });
	resolved = { ...variant.resolve!(stored, { LLM_KEY: "sk-test-plugin" }), variant: "Tiny", group: "ai" };
});

afterAll(async () => {
	unregisterBlock(PROJECT, TYPE);
	await closeCtxIntegrations();
	integrationRegistry.unregister(variant.group, variant.variant);
	server.stop(true);
});

const block = (id: string, type: string, data: object = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});
const META = { handles: { in: ["target"], out: ["source"], body: [] } } as never;

it("runs generateText with a KV tool, and traces each model call under the block", async () => {
	const kv = new Map<string, string>();
	const memoryKv = {
		get: async (k: string) => kv.get(k) ?? null,
		set: async (k: string, v: string) => void kv.set(k, v),
		setex: async () => {},
		delete: async () => {},
	};
	registerModuleBlock(
		PROJECT,
		TYPE,
		async (args) => {
			const open = withCtxIntegrations(args.ctx, (id) =>
				id === "llm"
					? { group: "ai", variant: "Tiny", config: resolved }
					: { group: "kv", variant: "Redis", config: {} },
			);
			try {
				const ctx = grantContext(open.ctx, { integrations: ["ai", "kv"], appconfig: false }, TYPE);
				const ai = await ctx.integrations!.get<"ai">("llm");
				const store = await ctx.integrations!.get<"kv">("store");
				const result = await generateText({
					model: ai.languageModel(),
					prompt: SECRET_PROMPT,
					tools: {
						remember: tool({
							inputSchema: z.object({ value: z.string() }),
							execute: async ({ value }) => {
								await store.set("colour", value);
								return "saved";
							},
						}),
					},
					stopWhen: stepCountIs(3),
				});
				return { output: result.text };
			} finally {
				open.release();
			}
		},
		META,
	);
	const { run } = compileGraph(
		[block("in", BlockTypes.entrypoint), block("p", TYPE), block("out", BlockTypes.response, { httpCode: "200" })],
		[edge("in", "p"), edge("p", "out")],
		{ projectId: PROJECT, blockMeta: { [TYPE]: META }, tracing: true } as never,
	);
	const runs: TraceRunPayload[] = [];
	const recorder = new RouteTraceRecorder(
		{ projectId: PROJECT, routeId: "r", routeVersion: "v", method: "POST", path: "/t" },
		(payload) => runs.push(payload),
	);
	const result = await run(
		{
			route: "/t",
			apiId: "a",
			projectId: PROJECT,
			vars: {},
			kvFactory: { getKvAdapter: () => memoryKv },
			trace: recorder,
		} as never,
		{},
	);
	recorder.complete("success", 200);

	expect(result.output.body).toBe("done");
	expect(kv.get("colour")).toBe("blue");
	expect(seen).toEqual([
		{ auth: "Bearer sk-test-plugin", model: "tiny" },
		{ auth: "Bearer sk-test-plugin", model: "tiny" },
	]);

	const spans = runs[0]!.spans;
	const owner = spans.find((s) => s.blockId === "p")!;
	const calls = spans.filter((s) => s.blockName === "ai:tiny.chat/tiny");
	expect(calls).toHaveLength(2);
	for (const call of calls) {
		expect(call).toMatchObject({ blockType: "span", parentSeq: owner.seq, outcome: "success" });
		expect(JSON.stringify(call.output)).toContain('"inputTokens"');
		expect(JSON.stringify(call)).not.toContain(SECRET_PROMPT);
	}
});
