import type { Plugin } from "@/services/plugins";
import { plugin } from "../../settings/plugins/fixtures";
import { buildPluginBlocks } from "./PluginBlocksContext";
import { pluginBlockDefs } from "./pluginBlocks";

const block = (name: string, over: Record<string, unknown> = {}) => ({
	name,
	label: name.split("/").at(-1),
	shape: "square",
	invoke: ["sync"],
	permissions: {},
	params: {},
	handles: { in: ["target"], out: ["success", "failure"], body: [] },
	deprecated: null,
	...over,
});

/** a wide agent block with three body handles, two of them stacked on one corner */
export const agent = block("acme/agent/run", {
	label: "Run agent",
	shape: "wide",
	invoke: ["async", "queued"],
	handles: {
		in: ["target"],
		out: ["success", "failure"],
		body: [
			{ name: "tools", corner: "bottom-left", allowMultiple: true },
			{ name: "memory", corner: "bottom-left" },
			{ name: "approval", corner: "top-right" },
		],
	},
});
export const post = block("acme/slack/messages/post", { label: "Post message" });
export const legacy = block("acme/slack/messages/legacy", {
	label: "Old post",
	deprecated: "Use Post message; removed in January.",
});
export const search = block("acme/slack/search", {
	label: "Search",
	description: "Find a message",
	handles: { in: ["target"], out: ["source"], body: [] },
});

/** one plugin per call, holding these blocks */
export const slack = (blocks: object[] = [post, legacy, search], over: Partial<Plugin> = {}) =>
	plugin({
		name: "acme/slack",
		manifest: {
			name: over.name ?? "acme/slack",
			blocks: Object.fromEntries(blocks.map((b) => [(b as { name: string }).name, b])),
		},
		...over,
	});

/** what a canvas of a project with these plugins sees */
export const blocksOf = (...plugins: Plugin[]) => buildPluginBlocks(pluginBlockDefs(plugins));
