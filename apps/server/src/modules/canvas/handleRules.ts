import { getOutputHandles, type HandleSpecs, isFanOutHandle } from "@fluxify/blocks/blockHandles";
import { BadRequestError } from "../../errors/badRequestError";

type Edge = { id: string; from?: string | null; fromHandle?: string | null };

/**
 * The runtime takes the first edge it finds for an output handle (fan-out
 * handles, whose edges are parallel branches, excepted). Rejecting fan-out
 * here protects every canvas writer, not only AI writers. A block with a
 * handle spec (a plugin manifest) may also only leave by handles it declares.
 */
export function assertOutputHandles(
	typeOf: (blockId: string) => string | null | undefined,
	edges: Edge[],
	specs: HandleSpecs = {},
) {
	const seen = new Map<string, string>();
	for (const edge of edges) {
		if (!edge.from) continue;
		const rawHandle = edge.fromHandle ?? "source";
		const handle = rawHandle.startsWith(`${edge.from}-`)
			? rawHandle.slice(edge.from.length + 1)
			: rawHandle;
		const type = typeOf(edge.from) ?? "";
		const spec = specs[type];
		if (spec && !getOutputHandles(type, spec).includes(handle))
			throw new BadRequestError(
				`${type} block ${edge.from} has no "${handle}" handle. Use ${getOutputHandles(type, spec).join(", ") || "none: it ends the flow"}.`,
			);
		if (isFanOutHandle(handle, spec)) continue;
		const key = `${edge.from}|${handle}`;
		const first = seen.get(key);
		if (first) {
			throw new BadRequestError(
				`Canvas has multiple outgoing edges on block ${edge.from}'s ${handle} handle (${first}, ${edge.id}).`,
			);
		}
		seen.set(key, edge.id);
	}
}
