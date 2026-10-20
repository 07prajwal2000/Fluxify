import { getOutputHandles, type HandleSpec } from "@fluxify/blocks/blockHandles";
import { z } from "zod";
import { type McpTool, projectId } from "./tools";

/** A block's docs can be long markdown; this is enough to wire it. */
const MAX_DOCS_CHARS = 1500;

type Plugin = {
	name: string;
	version: string;
	approval: string;
	devEnabled: boolean;
	prodEnabled: boolean;
	manifest: { blocks: Record<string, any> };
};

/** whether a canvas using it compiles, in words the agent can pass on */
const runs = (p: Plugin) =>
	p.approval !== "approved"
		? `no: ${p.approval === "pending" ? "waiting for a creator to approve it" : "rejected"}`
		: [p.devEnabled && "development", p.prodEnabled && "production"].filter(Boolean).join(", ") ||
			"no: enabled in no environment";

const params = (block: any) =>
	Object.entries(block.params as Record<string, any>).map(
		([name, p]) =>
			`- ${name}: ${p.type}${p.required ? " (required)" : ""}${p.options ? ` one of ${p.options.join(", ")}` : ""}${p.kind ? ` (a ${p.kind} integration id)` : ""}${p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : ""}${p.description ? `. ${p.description}` : ""}`,
	);

function contract(plugin: Plugin, type: string, block: any) {
	const handles = getOutputHandles(type, block.handles as HandleSpec);
	const docs = block.docs ? `\n${String(block.docs).slice(0, MAX_DOCS_CHARS)}` : "";
	return `${type} (${block.label}, plugin ${plugin.name}@${plugin.version}; runs in: ${runs(plugin)})
Params (block data keys):
${params(block).join("\n") || "- none"}
Handles (connect from): ${handles.join(", ") || "none, it ends the flow"}
Invoke: ${block.invoke.join(", ")}${block.deprecated ? `\nDeprecated: ${block.deprecated}` : ""}${docs}`;
}

/**
 * Plugin blocks (#857): blocks a project installed, described by their
 * manifest. `get_block_schemas` covers the built-in ones.
 */
export const pluginTools: McpTool[] = [
	{
		name: "get_plugin_blocks",
		title: "Get plugin blocks",
		description:
			"Blocks from the project's plugins. No blockTypes: the list. With blockTypes: each one's params, output handles, invoke modes and docs. A canvas may hold any of them, but it only runs once its plugin is approved and enabled in that environment.",
		role: "viewer",
		input: {
			projectId,
			blockTypes: z
				.array(z.string())
				.max(10)
				.optional()
				.describe("Plugin block types, e.g. ['acme/slack/messages/post']"),
		},
		call: async (api, a) => {
			const plugins: Plugin[] = (
				await api.get("/v1/plugins/list", { projectId: a.projectId })
			).filter((p: Plugin) => p.approval !== "rejected");
			const blocks = plugins.flatMap((p) =>
				Object.entries(p.manifest.blocks).map(([type, block]) => ({ p, type, block })),
			);
			if (!blocks.length) return "This project has no plugin blocks.";
			if (!a.blockTypes?.length)
				return blocks
					.map(({ p, type, block }) => `${type}: ${block.label}. Runs in: ${runs(p)}`)
					.join("\n");
			return a.blockTypes
				.map((type: string) => {
					const found = blocks.find((b) => b.type === type);
					return found
						? contract(found.p, type, found.block)
						: `${type}: no plugin of this project has it. Call get_plugin_blocks with no blockTypes for the list.`;
				})
				.join("\n\n");
		},
	},
];
