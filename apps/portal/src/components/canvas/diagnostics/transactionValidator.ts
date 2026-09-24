import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const TRANSACTION_SOURCE = "transaction-wiring";
export const SHARED_CHAIN =
	"This transaction's success or failure path leads into blocks that also run inside its executor chain. Keep the inside and the after paths separate: give each its own blocks.";
export const OUTSIDE_TRANSACTION =
	"This Rollback is reachable outside a Database Transaction, where it fails the run. Place it only in a chain wired to a transaction's executor handle.";

/** edges persist the handle as `<blockId>-executor`; agent-built ones may say just `executor` */
const isHandle = (blockId: string, handle: string, kind: string) =>
	handle === kind || handle === `${blockId}-${kind}`;

/**
 * What the transaction checks depend on: rollback/transaction ids and the wiring.
 * Empty when there is neither, so most canvases never run the walks.
 */
export function transactionTopologyKey(graph: CanvasGraph): string {
	const ids = graph.blocks
		.filter((b) => b.type === BLOCK_TYPES.db_rollback || b.type === BLOCK_TYPES.db_transaction)
		.map((b) => `${b.type}:${b.id}`);
	if (ids.length === 0) return "";
	return `${ids.join(",")}|${graph.edges.map((e) => `${e.from}>${e.fromHandle}>${e.to}`).join(",")}`;
}

type Edges = CanvasGraph["edges"];

function groupBy(edges: Edges, key: (edge: Edges[number]) => string) {
	const map = new Map<string, Edges>();
	for (const edge of edges) {
		const list = map.get(key(edge));
		if (list) list.push(edge);
		else map.set(key(edge), [edge]);
	}
	return map;
}

/**
 * Two checks, both walks over the wiring:
 * - a transaction's success/failure path must not lead into a block its own
 *   executor chain also reaches (error on the transaction);
 * - walking back from a rollback, every path must enter a transaction's
 *   executor handle before it reaches a block with no incoming edge (the
 *   entrypoint, the error handler); otherwise it can run outside one (warning).
 */
export function validateTransactions(graph: CanvasGraph): BlockDiagnostic[] {
	const transactions = new Set(
		graph.blocks.filter((b) => b.type === BLOCK_TYPES.db_transaction).map((b) => b.id),
	);
	const rollbacks = graph.blocks.filter((b) => b.type === BLOCK_TYPES.db_rollback);
	if (transactions.size === 0 && rollbacks.length === 0) return [];

	const incoming = groupBy(graph.edges, (e) => e.to);
	const outgoing = groupBy(graph.edges, (e) => e.from);
	const diagnostics: BlockDiagnostic[] = [];

	/** every block reachable from the edges leaving `from` on `kind` */
	const reach = (from: string, kind: string) => {
		const seen = new Set<string>();
		const stack = (outgoing.get(from) ?? [])
			.filter((e) => isHandle(from, e.fromHandle, kind))
			.map((e) => e.to);
		for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
			if (seen.has(id)) continue;
			seen.add(id);
			for (const edge of outgoing.get(id) ?? []) stack.push(edge.to);
		}
		return seen;
	};

	for (const tx of transactions) {
		const inside = reach(tx, "executor");
		if (inside.size === 0) continue;
		const after = [...reach(tx, "success"), ...reach(tx, "failure")];
		if (after.some((id) => inside.has(id))) {
			diagnostics.push({
				blockId: tx,
				severity: "error",
				message: SHARED_CHAIN,
				source: TRANSACTION_SOURCE,
			});
		}
	}

	const escapes = (start: string) => {
		const seen = new Set([start]);
		const stack = [start];
		for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
			const edges = incoming.get(id) ?? [];
			if (edges.length === 0) return true;
			for (const edge of edges) {
				if (transactions.has(edge.from) && isHandle(edge.from, edge.fromHandle, "executor"))
					continue;
				if (!seen.has(edge.from)) {
					seen.add(edge.from);
					stack.push(edge.from);
				}
			}
		}
		return false;
	};

	for (const b of rollbacks) {
		if ((incoming.get(b.id)?.length ?? 0) > 0 && escapes(b.id)) {
			diagnostics.push({
				blockId: b.id,
				severity: "warning",
				message: OUTSIDE_TRANSACTION,
				source: TRANSACTION_SOURCE,
			});
		}
	}
	return diagnostics;
}
