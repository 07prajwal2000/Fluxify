import { BlockTypes } from "@fluxify/blocks";
import type { CanvasIssue, RulesInput } from "./rules";

/**
 * Warnings about a canvas that does not lead anywhere (#704). Warnings only: a
 * canvas being built is allowed to be half wired.
 *
 * - every canvas: a block nothing connects to the entrypoint (or the error
 *   handler, which the runtime enters by itself) never runs;
 * - route: no path to a Response block returns the default response;
 * - route: an `if` / `row exists` branch left open ends the flow with no
 *   response. Handles that are open by design stay quiet: a retry or
 *   transaction `failure` (the error just fails the route), a loop body, an
 *   orchestrate branch. A workflow or custom block may end anywhere.
 */
const BRANCHING = new Set<string>([BlockTypes.if, BlockTypes.db_exists]);
/** the chain wired here is a body, not the way on: its open end is by design */
const BODY_HANDLES = new Set(["executor", "orchestrate"]);
const ROOTS = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);

/** edges persist the handle as `<blockId>-<kind>`; agent-built ones may say just `<kind>` */
const handleOf = (from: string | null | undefined, handle?: string | null) =>
	from && handle?.startsWith(`${from}-`) ? handle.slice(from.length + 1) : (handle ?? "source");

type Block = RulesInput["blocks"][number];

function walk(starts: string[], edges: RulesInput["edges"], skipBodies: boolean) {
	const seen = new Set(starts);
	const queue = [...starts];
	while (queue.length) {
		const id = queue.pop()!;
		for (const e of edges) {
			if (e.from !== id || (e.to && seen.has(e.to))) continue;
			if (skipBodies && BODY_HANDLES.has(handleOf(e.from, e.fromHandle))) continue;
			if (!e.to) continue;
			seen.add(e.to);
			queue.push(e.to);
		}
	}
	return seen;
}

export function reachabilityIssues({ kind, blocks, edges }: RulesInput): CanvasIssue[] {
	const entry = blocks.find((b) => b.type === BlockTypes.entrypoint);
	if (!entry) return [];
	const name = (b: Block) => b.key ?? b.id;
	const warn = (b: Block, message: string): CanvasIssue => ({
		severity: "warning",
		message,
		blockId: b.id,
	});

	const roots = blocks.filter((b) => ROOTS.has(b.type ?? "")).map((b) => b.id);
	const live = walk(roots, edges, false);
	const out = blocks
		.filter((b) => !live.has(b.id) && b.type !== BlockTypes.sticky_note)
		.map((b) => warn(b, `${name(b)} is not connected to the flow, so it never runs.`));
	if (kind !== "route") return out;

	const main = walk([entry.id], edges, true);
	const reach = walk([entry.id], edges, false);
	if (!blocks.some((b) => b.type === BlockTypes.response && reach.has(b.id))) {
		out.push(
			warn(
				entry,
				"No path from entrypoint to a response block: the route returns the default response (NO RESULT).",
			),
		);
	}
	for (const b of blocks) {
		if (!BRANCHING.has(b.type ?? "") || !main.has(b.id)) continue;
		for (const handle of ["success", "failure"]) {
			const open = !edges.some((e) => e.from === b.id && handleOf(b.id, e.fromHandle) === handle);
			if (open)
				out.push(
					warn(b, `${name(b)}.${handle} is not connected: the flow stops there with no response.`),
				);
		}
	}
	return out;
}
