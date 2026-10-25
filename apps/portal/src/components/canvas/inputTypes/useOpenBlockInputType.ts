import { useBlockInputType } from "@fluxify/components";
import { useEffect, useMemo, useState } from "react";
import { resolveInputType } from "./resolveInputType";
import { DEBOUNCE_MS, graphSignature, useInputTypeContext } from "./useInputTypeContext";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

/**
 * Types `input` in every editor of the block whose settings are open, from the
 * blocks wired into it. The types are global in Monaco, so this follows the
 * one open block: closing it, or opening another, drops the previous type.
 */
export function useOpenBlockInputType(
	blockId: string | null,
	nodes: GraphNode[],
	edges: GraphEdge[],
) {
	const ctx = useInputTypeContext();
	const signature = useMemo(
		() => (blockId ? graphSignature(nodes, edges) : ""),
		[blockId, nodes, edges],
	);
	const [resolved, setResolved] = useState<{ blockId: string; type: string } | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for nodes and edges
	useEffect(() => {
		if (!blockId) return;
		let live = true;
		const timer = setTimeout(() => {
			resolveInputType(blockId, nodes, edges, ctx)
				.then((type) => live && setResolved({ blockId, type }))
				.catch(() => live && setResolved(null));
		}, DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [blockId, signature, ctx]);

	useBlockInputType(resolved?.blockId === blockId ? resolved?.type : undefined);
}
