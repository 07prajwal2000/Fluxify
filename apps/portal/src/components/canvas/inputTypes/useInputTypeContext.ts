import { inferScriptOutput } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { integrationMetadataOptions } from "@/query/findResourceQuery";
import { typeDependencies } from "./blockOutputs";
import type { InferOutput, InputTypeContext } from "./resolveInputType";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

/** Waits for typing to pause before asking the TypeScript worker anything. */
export const DEBOUNCE_MS = 400;
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

/** Script inference, and the database metadata the settings panels already load. */
export function useInputTypeContext(): InputTypeContext {
	const queryClient = useQueryClient();
	const projectId = (useParams({ strict: false }) as { projectId?: string }).projectId ?? "";
	return useMemo(
		() => ({
			infer: cachedInfer,
			loadDbMeta: async (connectionId: string) => {
				const data = await queryClient.ensureQueryData(
					integrationMetadataOptions(projectId, connectionId),
				);
				return data ? { variant: data.variant, tables: data.metadata.tables } : null;
			},
		}),
		[queryClient, projectId],
	);
}

/** Only what a type can depend on, so moving a block recomputes nothing. */
export const graphSignature = (nodes: GraphNode[], edges: GraphEdge[]) =>
	JSON.stringify([
		nodes.map(typeDependencies).filter(Boolean),
		edges.map((edge) => [edge.source, edge.sourceHandle, edge.target]),
	]);
