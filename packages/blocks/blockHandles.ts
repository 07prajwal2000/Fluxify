import z from "zod";
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

/** Where a body handle sits: left corners are above/below the icon, right ones opposite. */
export type BodyCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * A block type's handles as plain data (a plugin manifest, `BlockMeta.handles`).
 * Every consumer — compiler, layout, save validation, AI gateway, portal —
 * resolves through the functions below, so none needs the block's code.
 */
export type HandleSpec = {
	in: string[];
	out: [] | ["source"] | ["success", "failure"];
	body: { name: string; corner: BodyCorner; allowMultiple?: boolean }[];
};

/** Specs by block type, for callers that resolve many blocks; a type not in it is builtin. */
export type HandleSpecs = Readonly<Record<string, HandleSpec | undefined>>;

// an edge handle id is `<blockId>-<name>`, and readers split on the last `-`
const handleName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a plain identifier");

export const handleSpecSchema = z
	.object({
		in: z.array(handleName).default(["target"]),
		out: z.union([
			z.tuple([]),
			z.tuple([z.literal("source")]),
			z.tuple([z.literal("success"), z.literal("failure")]),
		]),
		body: z
			.array(
				z.object({
					name: handleName,
					corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
					allowMultiple: z.boolean().optional(),
				}),
			)
			.default([]),
	})
	.superRefine((spec, ctx) => {
		const names = [...spec.in, ...spec.out, ...spec.body.map((b) => b.name)];
		const dupes = names.filter((n, i) => names.indexOf(n) !== i);
		if (dupes.length)
			ctx.addIssue({ code: "custom", message: `duplicate handle names: ${[...new Set(dupes)]}` });
	});

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
