import type { Param } from "@fluxify/sdk/blocks";
import { pluginParamProblems } from "../panel/blocks/pluginParamProblems";
import { isPluginType, type PluginBlockDef } from "../plugins/pluginBlocks";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const PLUGIN_PARAMS_SOURCE = "plugin-params";

/**
 * The params the server refuses a plugin block's save for (required, type,
 * options, bounds, list and row rules), found before the save is sent. Every
 * plugin block counts, wired or not: the server checks each one it is sent.
 */
export function validatePluginParams(
	graph: CanvasGraph,
	byType: Record<string, PluginBlockDef | undefined>,
): BlockDiagnostic[] {
	return graph.blocks.flatMap((block) => {
		const def = isPluginType(block.type) ? byType[block.type ?? ""] : undefined;
		if (!def) return [];
		const params = def.entry.params as Record<string, Param>;
		return Object.entries(pluginParamProblems(params, block.data ?? {})).map(
			([name, message]): BlockDiagnostic => ({
				blockId: block.id,
				severity: "error",
				message,
				source: PLUGIN_PARAMS_SOURCE,
				tab: params[name]?.tab,
			}),
		);
	});
}
