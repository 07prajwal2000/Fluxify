import {
	type BlockDTOType,
	type BlockMeta,
	compileGraph,
	type EdgeDTOSchemaType,
	type HandleSpec,
} from "@fluxify/blocks";
import type { DbTransactionType } from "../../db";
import type { FluxifyEnv } from "../../lib/env";
import { blockMetaOf, unusableReason } from "./meta";
import { listPluginRows } from "./repository";

/**
 * What compiling a project's graphs needs to know about its plugins (#857):
 * `blockMeta` for every block of a plugin usable in the environment, and a
 * reason for every block of one that is not.
 */
export type PluginSet = {
	blockMeta: Record<string, BlockMeta>;
	unusable: Map<string, string>;
};

/** each environment's set, from one read */
export async function loadPluginSets(projectId: string): Promise<Record<FluxifyEnv, PluginSet>> {
	const rows = await listPluginRows(projectId);
	const setFor = (env: FluxifyEnv) => {
		const set: PluginSet = { blockMeta: {}, unusable: new Map() };
		for (const row of rows) {
			const reason = unusableReason(row, env);
			for (const [type, entry] of Object.entries(row.manifest.blocks)) {
				if (reason) set.unusable.set(type, reason);
				else set.blockMeta[type] = blockMetaOf(entry);
			}
		}
		return set;
	};
	return { development: setFor("development"), production: setFor("production") };
}

/**
 * `compileGraph` with the project's plugin blocks. A graph that calls a block
 * of a plugin that may not load fails naming the plugin and why, rather than
 * the compiler's bare "No codegen".
 */
export function compileWithPlugins(
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
	options: Omit<NonNullable<Parameters<typeof compileGraph>[2]>, "blockMeta">,
	plugins: PluginSet,
) {
	for (const block of blocks) {
		const reason = plugins.unusable.get(block.type);
		if (reason) throw new Error(`Block ${block.type} cannot run: ${reason}.`);
	}
	return compileGraph(blocks, edges, { ...options, blockMeta: plugins.blockMeta });
}

/** what an artifact keeps of a build: its source, and the plugin blocks a worker imports first */
export const artifactBuild = ({
	source,
	pluginBlocks,
}: {
	source: string;
	pluginBlocks: string[];
}) => (pluginBlocks.length ? { source, pluginBlocks } : { source });

/**
 * Handle specs of every plugin block a canvas may hold: any plugin of the
 * project not rejected. A canvas is data; whether the block may run is the
 * compiler's call, so a block of a plugin waiting for approval can be wired.
 */
export async function canvasPluginSpecs(projectId: string | null, tx?: DbTransactionType) {
	const specs: Record<string, HandleSpec> = {};
	if (!projectId) return specs;
	for (const row of await listPluginRows(projectId, tx)) {
		if (row.approval === "rejected") continue;
		for (const [type, entry] of Object.entries(row.manifest.blocks))
			specs[type] = entry.handles as HandleSpec;
	}
	return specs;
}
