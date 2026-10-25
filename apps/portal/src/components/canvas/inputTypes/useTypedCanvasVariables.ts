import { useEffect, useMemo, useState } from "react";
import { createResolver, SAVES_ON_SUCCESS } from "./resolveInputType";
import { DEBOUNCE_MS, graphSignature, useInputTypeContext } from "./useInputTypeContext";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

/** A canvas variable and the block (and Set Var row) that writes it. */
type Origin = { name: string; source: string; output?: true; id?: string; row?: number };
type Typed = Origin & { type?: string };

/**
 * The canvas variables with the type each one holds, once it is worked out:
 * a Set Var key is what its value stores, `outputs.<name>` is what the block
 * that saves it hands on. Until then, and for anything it cannot place, they
 * come back untyped, which the editor reads as `any`.
 */
export function useTypedCanvasVariables(
	variables: Origin[],
	nodes: GraphNode[],
	edges: GraphEdge[],
): Typed[] {
	const ctx = useInputTypeContext();
	const signature = useMemo(
		() => JSON.stringify([variables, graphSignature(nodes, edges)]),
		[variables, nodes, edges],
	);
	const [typed, setTyped] = useState<{ signature: string; list: Typed[] } | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for the inputs
	useEffect(() => {
		// nothing to type, or nothing that could hold a type worth the worker
		if (variables.length === 0) return;
		let live = true;
		const timer = setTimeout(() => {
			const resolver = createResolver(nodes, edges, ctx);
			const typeOf = async (variable: Origin): Promise<string | undefined> => {
				if (!variable.id) return undefined;
				if (!variable.output) return resolver.setVarType(variable.id, variable.row ?? 0);
				const block = nodes.find((node) => node.id === variable.id);
				return resolver.outputType(
					variable.id,
					SAVES_ON_SUCCESS.has(block?.type ?? "") ? "success" : "source",
				);
			};
			Promise.all(
				variables.map(async (v) => ({ ...v, type: await typeOf(v).catch(() => undefined) })),
			)
				.then((list) => live && setTyped({ signature, list }))
				.catch(() => live && setTyped(null));
		}, DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [signature, ctx]);

	return typed?.signature === signature ? typed.list : variables;
}
