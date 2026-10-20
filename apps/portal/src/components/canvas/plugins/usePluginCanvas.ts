import { type RefObject, useCallback } from "react";
import type { BlockNode } from "../types";
import { usePluginBlocks } from "./PluginBlocksContext";
import { pluginBlockData } from "./pluginBlocks";

/** What the open canvas needs of the plugin blocks it may hold: the handle specs, and the two lookups by block. */
export function usePluginCanvas(latest: RefObject<{ nodes: BlockNode[] }>) {
	const { byType, specs } = usePluginBlocks();
	/** the data a block starts with when it is added; `undefined` for anything that is not a plugin's */
	const dataFor = useCallback(
		(type: string) => {
			const def = byType[type];
			return def && pluginBlockData(def);
		},
		[byType],
	);
	/** the handle spec of the block with this id, when it is a plugin's */
	const specOf = useCallback(
		(nodeId: string) => specs[latest.current.nodes.find((n) => n.id === nodeId)?.type ?? ""],
		[specs, latest],
	);
	return { specs, dataFor, specOf };
}
