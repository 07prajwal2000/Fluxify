import { inferScriptOutput, useBlockInputType } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { integrationMetadataOptions } from "@/query/findResourceQuery";
import { typeDependencies } from "./blockOutputs";
import { type InferOutput, resolveInputType } from "./resolveInputType";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

/** Waits for typing to pause before asking the TypeScript worker anything. */
const DEBOUNCE_MS = 400;
const MAX_CACHED = 200;

// the same script against the same input always returns the same type
const cache = new Map<string, Promise<string>>();
const cachedInfer: InferOutput = (source, inputType) => {
	const key = `${inputType}\u0000${source}`;
	let hit = cache.get(key);
	if (!hit) {
		if (cache.size >= MAX_CACHED) cache.clear();
		hit = inferScriptOutput(source, inputType);
		cache.set(key, hit);
	}
	return hit;
};

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
	const queryClient = useQueryClient();
	const projectId = (useParams({ strict: false }) as { projectId?: string }).projectId ?? "";
	// only what a type can depend on, so moving a block recomputes nothing
	const signature = useMemo(
		() =>
			blockId
				? JSON.stringify([
						nodes.map(typeDependencies).filter(Boolean),
						edges.map((edge) => [edge.source, edge.sourceHandle, edge.target]),
					])
				: "",
		[blockId, nodes, edges],
	);
	const [resolved, setResolved] = useState<{ blockId: string; type: string } | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for nodes and edges
	useEffect(() => {
		if (!blockId) return;
		let live = true;
		const loadDbMeta = async (connectionId: string) => {
			const data = await queryClient.ensureQueryData(
				integrationMetadataOptions(projectId, connectionId),
			);
			return data ? { variant: data.variant, tables: data.metadata.tables } : null;
		};
		const timer = setTimeout(() => {
			resolveInputType(blockId, nodes, edges, { infer: cachedInfer, loadDbMeta })
				.then((type) => live && setResolved({ blockId, type }))
				.catch(() => live && setResolved(null));
		}, DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [blockId, signature, projectId, queryClient]);

	useBlockInputType(resolved?.blockId === blockId ? resolved?.type : undefined);
}
