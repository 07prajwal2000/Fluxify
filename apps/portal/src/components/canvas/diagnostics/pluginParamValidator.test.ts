import { expect, test } from "bun:test";
import type { PluginBlockDef } from "../plugins/pluginBlocks";
import type { CanvasGraph } from "../types";
import { validatePluginParams } from "./pluginParamValidator";

const TYPE = "acme/slack/post";
const def = (params: object) =>
	({ type: TYPE, entry: { params } }) as unknown as PluginBlockDef;
const graph = (...blocks: { id: string; type: string; data: Record<string, unknown> }[]) =>
	({
		blocks: blocks.map((b) => ({ ...b, position: { x: 0, y: 0 } })),
		edges: [],
	}) as unknown as CanvasGraph;

const byType = {
	[TYPE]: def({
		channel: { type: "string", label: "Channel", required: true, tab: "Target" },
		retries: { type: "number", max: 5 },
	}),
};

test("a plugin block's refused params are errors on that block, naming the tab to fix them in", () => {
	const found = validatePluginParams(
		graph(
			{ id: "b1", type: TYPE, data: { retries: 9 } },
			{ id: "b2", type: TYPE, data: { channel: "#ops" } },
		),
		byType,
	);
	expect(found).toEqual([
		{
			blockId: "b1",
			severity: "error",
			source: "plugin-params",
			message: "Channel is required",
			tab: "Target",
		},
		{
			blockId: "b1",
			severity: "error",
			source: "plugin-params",
			message: "retries must be at most 5, got 9",
			tab: undefined,
		},
	]);
});

test("a block that is not a plugin block, or whose plugin is not known, is left alone", () => {
	expect(
		validatePluginParams(
			graph({ id: "b1", type: "response", data: {} }, { id: "b2", type: "acme/gone/x", data: {} }),
			byType,
		),
	).toEqual([]);
});

test("js: values are not checked", () => {
	expect(
		validatePluginParams(graph({ id: "b1", type: TYPE, data: { channel: "js: x", retries: "js: 9" } }), byType),
	).toEqual([]);
});
