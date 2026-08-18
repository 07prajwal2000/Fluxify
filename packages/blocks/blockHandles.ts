import { BlockTypes } from "./blockTypes";

/**
 * Which output handles each block type actually exposes.
 *
 * Mirrors the `findEdge(block, <handle>, edgesMap)` calls in `blockFactory.ts`.
 * `findEdge` takes the FIRST edge matching a handle and silently discards the
 * rest, so a handle carrying two edges is not a parallel branch — it is one
 * branch plus a dropped one. Anything building a graph must treat a handle as
 * holding at most one edge, and must not invent handles a block does not have.
 */
export const BLOCK_OUTPUT_HANDLES: Record<string, readonly string[]> = {
	[BlockTypes.if]: ["success", "failure"],
	[BlockTypes.forloop]: ["source", "executor"],
	[BlockTypes.foreachloop]: ["source", "executor"],
	[BlockTypes.db_transaction]: ["source", "executor"],
	// terminal — the runtime never looks for an outgoing edge
	[BlockTypes.response]: [],
	[BlockTypes.sticky_note]: [],
};

/** Handles for a block type; everything not listed above is a plain `source`. */
export const getOutputHandles = (blockType: string): readonly string[] =>
	BLOCK_OUTPUT_HANDLES[blockType] ?? ["source"];

/** Socket kinds a block can expose. Ids on edges are `<blockId>-<kind>`. */
export type HandleKind = "source" | "target" | "executor" | "success" | "failure";

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
} as const satisfies Record<HandleKind, HandleSide>;
