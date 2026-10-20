import type { HandleSpecs } from "@fluxify/blocks/layout";
import { useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { pluginsQuery } from "@/query/pluginsQuery";
import { type PluginBlockDef, pluginBlockDefs, pluginHandleSpecs } from "./pluginBlocks";

export type PluginBlocks = {
	defs: PluginBlockDef[];
	byType: Record<string, PluginBlockDef | undefined>;
	/** the handle specs the layout, quick add and the handle rules read, by block type */
	specs: HandleSpecs;
	/** the project's plugins are still being fetched: a plugin block is not missing yet */
	isLoading: boolean;
};

export const buildPluginBlocks = (defs: PluginBlockDef[], isLoading = false): PluginBlocks => ({
	defs,
	byType: Object.fromEntries(defs.map((def) => [def.type, def])),
	specs: pluginHandleSpecs(defs),
	isLoading,
});

const NONE = buildPluginBlocks([]);

/**
 * The blocks of a plugin list response. Anything but a list (the request
 * failed, or the server answered otherwise) leaves the canvas without plugin
 * blocks, not broken.
 */
export const pluginBlocksFrom = (data: unknown, isLoading: boolean): PluginBlocks =>
	Array.isArray(data) ? buildPluginBlocks(pluginBlockDefs(data)) : { ...NONE, isLoading };

export const PluginBlocksContext = createContext<PluginBlocks>(NONE);

/** The plugin blocks of the open canvas's project; none outside a provider. */
export const usePluginBlocks = () => useContext(PluginBlocksContext);

/**
 * Loads the project's plugin manifests once for the whole canvas. Nodes, the
 * picker, quick add and the layout all read this one value, so they agree on
 * every block's handles. The fetch is the plugin list the settings page uses,
 * so React Query serves a canvas opened after it from the cache.
 */
export function PluginBlocksProvider({ children }: { children: ReactNode }) {
	const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
	const { data, isLoading } = pluginsQuery.list.useQuery(projectId, !!projectId);
	const value = useMemo(() => pluginBlocksFrom(data, isLoading), [data, isLoading]);
	return <PluginBlocksContext.Provider value={value}>{children}</PluginBlocksContext.Provider>;
}
