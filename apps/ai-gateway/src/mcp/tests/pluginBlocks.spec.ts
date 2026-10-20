import { describe, expect, it } from "bun:test";
import type { HandleSpec } from "@fluxify/blocks/blockHandles";
import type { AdminApi } from "../adminApi";
import { opsToChanges } from "../canvasOps";
import { pluginTools } from "../pluginTools";

const TYPE = "acme/echo/step";
const spec: HandleSpec = { in: ["target"], out: ["success", "failure"], body: [] };
const at = (x: number) => ({ x, y: 0 });
/** entry → a plugin block, with the specs the canvas read returns (#857) */
const canvas = () => ({
	blocks: [
		{ id: "entry", key: "entrypoint_1", type: "entrypoint", data: {}, position: at(0) },
		{ id: "step", key: "custom_acme_echo_step_1", type: TYPE, data: {}, position: at(300) },
		{ id: "resp", key: "response_1", type: "response", data: {}, position: at(600) },
	],
	edges: [{ id: "e1", from: "entry", to: "step", fromHandle: "entry-source", toHandle: "step-target" }],
	handleSpecs: { [TYPE]: spec },
});

describe("plugin blocks on the agent's canvas (#857)", () => {
	it("connects on the handles the manifest declares", () => {
		const { changes, describe } = opsToChanges(canvas(), [
			{ op: "connect", from: "custom_acme_echo_step_1", to: "response_1", handle: "failure" },
		]);
		expect(changes.changes.edges).toContainEqual(
			expect.objectContaining({ from: "step", to: "resp", fromHandle: "step-failure" }),
		);
		expect(describe((ref) => ref)).toEqual(["connected step.failure → resp"]);
	});

	it("refuses a handle the manifest does not have, and asks for one of two", () => {
		const ops = (handle?: string) => [{ op: "connect" as const, from: "custom_acme_echo_step_1", to: "response_1", handle }];
		expect(() => opsToChanges(canvas(), ops("source"))).toThrow(
			`${TYPE} block custom_acme_echo_step_1 has no "source" handle. Use success, failure.`,
		);
		expect(() => opsToChanges(canvas(), ops())).toThrow("pass handle as one of success, failure");
	});
});

describe("get_plugin_blocks", () => {
	const plugins = [
		{
			name: "acme/echo",
			version: "2026.10.2001",
			approval: "approved",
			devEnabled: true,
			prodEnabled: false,
			manifest: {
				blocks: {
					[TYPE]: {
						label: "Step",
						invoke: ["sync"],
						handles: spec,
						params: {
							text: { type: "string", required: true },
							conn: { type: "integration", kind: "kv" },
							headers: { type: "keyValue" },
							to: { type: "array", min: 1, max: 3 },
							shape: { type: "fieldMap" },
							note: { type: "hint", text: "Read this" },
						},
						docs: "## When to use it",
					},
				},
			},
		},
		{ name: "acme/gone", approval: "rejected", manifest: { blocks: { "acme/gone/x": {} } } },
	];
	const api = { get: async () => plugins } as unknown as AdminApi;
	const tool = pluginTools.find((t) => t.name === "get_plugin_blocks")!;

	it("lists the blocks of plugins not rejected, with where they run", async () => {
		expect(await tool.call(api, { projectId: "p" })).toBe(`${TYPE}: Step. Runs in: development`);
	});

	it("gives a block's params, handles and docs", async () => {
		const text = (await tool.call(api, { projectId: "p", blockTypes: [TYPE, "acme/gone/x"] })) as string;
		expect(text).toContain("- text: string (required) (a literal, or 'js:<function body>'");
		expect(text).toContain("- headers: keyValue (an object; each value a literal or 'js:...'");
		expect(text).toContain("- to: array (an array; each item a literal or 'js:...') (at least 1, at most 3 items)");
		expect(text).toContain("- shape: fieldMap ({ sourceKey: destinationKey }");
		expect(text).not.toContain("note");
		expect(text).toContain("- conn: integration (a kv integration id)");
		expect(text).toContain("Handles (connect from): success, failure");
		expect(text).toContain("## When to use it");
		expect(text).toContain("acme/gone/x: no plugin of this project has it");
	});
});
