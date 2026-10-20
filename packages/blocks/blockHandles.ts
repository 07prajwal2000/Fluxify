import type { BodyCorner, HandleSpec } from "@fluxify/sdk";
import { BlockTypes } from "./blockTypes";

/**
 * Which output handles each block type actually exposes.
 *
 * Mirrors the `findEdge(block, <handle>, edgesMap)` calls in `blockFactory.ts`.
 * `findEdge` takes the FIRST edge matching a handle and silently discards the
 * rest, so a handle carrying two edges is not a parallel branch — it is one
 * branch plus a dropped one. Anything building a graph must treat a handle as
 * holding at most one edge (except `FAN_OUT_HANDLES`), and must not invent
 * handles a block does not have.
 */
export const BLOCK_OUTPUT_HANDLES: Record<string, readonly string[]> = {
	[BlockTypes.if]: ["success", "failure"],
	[BlockTypes.db_exists]: ["success", "failure"],
	[BlockTypes.queue_send]: ["success", "failure"],
	[BlockTypes.forloop]: ["source", "executor"],
	[BlockTypes.foreachloop]: ["source", "executor"],
	[BlockTypes.db_transaction]: ["success", "failure", "executor"],
	[BlockTypes.retry]: ["success", "failure", "executor"],
	[BlockTypes.orchestrator]: ["source", "orchestrate"],
	[BlockTypes.switch]: ["case"],
	// terminal — the runtime never looks for an outgoing edge
	[BlockTypes.response]: [],
	[BlockTypes.db_rollback]: [],
	[BlockTypes.sticky_note]: [],
};

// the plain-data handle shapes live in the SDK, the one package plugins see
export { type BodyCorner, type HandleSpec, handleSpecSchema } from "@fluxify/sdk";

/** Specs by block type, for callers that resolve many blocks; a type not in it is builtin. */
export type HandleSpecs = Readonly<Record<string, HandleSpec | undefined>>;

/** Handles for a block type; everything not listed above is a plain `source`. */
export const getOutputHandles = (blockType: string, spec?: HandleSpec): readonly string[] =>
	spec
		? [...spec.out, ...spec.body.map((b) => b.name)]
		: (BLOCK_OUTPUT_HANDLES[blockType] ?? ["source"]);

/** Does this handle start a nested chain (drawn on top, its branch sorted first)? */
export const isBodyHandle = (handle: string, spec?: HandleSpec) =>
	spec ? spec.body.some((b) => b.name === handle) : BODY_HANDLES.includes(handle);

/** May this handle carry more than one edge, each its own branch? */
export const isFanOutHandle = (handle: string, spec?: HandleSpec) =>
	spec
		? !!spec.body.find((b) => b.name === handle)?.allowMultiple
		: FAN_OUT_HANDLES.includes(handle);

/** A spec'd body handle's corner; builtin handles have none. */
export const handleCorner = (handle: string, spec?: HandleSpec): BodyCorner | undefined =>
	spec?.body.find((b) => b.name === handle)?.corner;

/** Which side a handle (bare name) sits on; unknown names fall to the right. */
export function sideOf(handle: string, spec?: HandleSpec): HandleSide {
	if (!spec) return HANDLE_SIDE[handle as HandleKind] ?? "right";
	const corner = handleCorner(handle, spec);
	if (corner) return corner.startsWith("top") ? "top" : "bottom";
	return spec.in.includes(handle) ? "left" : "right";
}

/** Socket kinds a block can expose. Ids on edges are `<blockId>-<kind>`. */
export type HandleKind =
	| "source"
	| "target"
	| "executor"
	| "success"
	| "failure"
	| "orchestrate"
	| "case";

/** Handles that start a nested chain: drawn above the "next" handle, and their branch sorts first. */
export const BODY_HANDLES: readonly string[] = ["executor", "orchestrate"];

/** The only output handles that may carry more than one edge: each edge is its own branch. */
export const FAN_OUT_HANDLES: readonly string[] = ["orchestrate", "case"];

/**
 * Sorts fan-out branches by a stored list of target ids. Anything not listed
 * keeps its original order, after the listed ones — a new connection lands last.
 */
export function sortByOrder<T>(
	items: readonly T[],
	order: readonly string[],
	idOf: (item: T) => string,
): T[] {
	const rank = (item: T) => {
		const index = order.indexOf(idOf(item));
		return index === -1 ? order.length : index;
	};
	return [...items].sort((a, b) => rank(a) - rank(b));
}

/** Which edge of a block a socket rail can sit on. */
export type HandleSide = "left" | "right" | "top" | "bottom";

/**
 * Which edge of the block each socket rail sits on. Layout (server and editor)
 * and the editor's rendering both read this, so a socket cannot be drawn on one
 * side and routed to another.
 */
export const HANDLE_SIDE = {
	target: "left",
	source: "right",
	success: "right",
	failure: "right",
	executor: "top",
	orchestrate: "top",
	case: "right",
} as const satisfies Record<HandleKind, HandleSide>;
