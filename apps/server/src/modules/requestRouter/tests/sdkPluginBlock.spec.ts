import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { type BlockDTOType, BlockTypes, compileGraph } from "@fluxify/blocks";
import { toManifestEntry } from "@fluxify/sdk/blocks";
import { loadPluginBlocks, setPluginRefs } from "../pluginLoader";
import hello from "./sdkPluginBlock.fixture";

const P = "proj-sdk-block";
const TYPE = "acme/greet/hello";
const entry = toManifestEntry(hello);
// the engine metadata a manifest entry stands for (what P3 hands the loader)
const meta = {
	handles: entry.handles,
	invoke: entry.invoke,
	schemaParams: Object.keys(entry.params).filter((k) => entry.params[k].type === "schema"),
};

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});
const ctx = () =>
	({
		route: "/hello",
		apiId: "api-1",
		projectId: P,
		vars: {},
	}) as any;

/** entry -> hello -> 200 on success / 400 on failure; its body chain upper-cases */
const graph = (data: object, input = "{}") =>
	compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("in", BlockTypes.jsrunner, { value: `return ${input};` }),
			block("hello", TYPE, data),
			block("up", BlockTypes.jsrunner, { value: "return input.toUpperCase();" }),
			block("ok", BlockTypes.response, { httpCode: "200" }),
			block("bad", BlockTypes.response, { httpCode: "400" }),
		],
		[
			edge("entry", "in"),
			edge("in", "hello"),
			edge("hello", "up", "decorate"),
			edge("hello", "ok", "success"),
			edge("hello", "bad", "failure"),
		],
		{ projectId: P, blockMeta: { [TYPE]: meta } },
	);
const reply = async (data: object, input?: string) => {
	const { output } = await graph(data, input).run(ctx(), {});
	return { status: output.httpCode, body: output.body };
};

describe("an SDK-defined block through the plugin loader", () => {
	it("loads the module's default export and runs it in a compiled graph", async () => {
		setPluginRefs([
			{
				projectId: P,
				type: TYPE,
				plugin: "acme/greet",
				version: "1.0.0",
				entry: join(import.meta.dir, "sdkPluginBlock.fixture.ts"),
				meta,
			},
		]);
		await loadPluginBlocks(P, [TYPE]);
		expect(graph({ who: "ada" }).pluginBlocks).toEqual([TYPE]);
		// default filled, body chain run through executeHandle
		expect(await reply({ who: "ada" })).toEqual({ status: "200", body: "hello ADA x2" });
		expect(await reply({ who: "js:return 'bob'", times: 3 })).toEqual({
			status: "200",
			body: "hello BOB x3",
		});
	});

	it("hands a schema param as { zod, schema } and routes by the returned handle", async () => {
		const shape = { dataType: "object", properties: [{ key: "n", dataType: "int", required: true }] };
		expect(await reply({ who: "ada", shape }, "{ n: 1 }")).toMatchObject({ status: "200" });
		expect(await reply({ who: "ada", shape }, "{ n: 'x' }")).toEqual({
			status: "400",
			body: "input does not fit the schema",
		});
	});

	it("fails to failure when a required param is missing", async () => {
		expect(await reply({})).toEqual({ status: "400", body: "param 'who' is required" });
	});
});
