import { BlockTypes } from "./blockTypes";

/**
 * Wiring rules for DB Transaction and Rollback blocks, shared by the editor's
 * diagnostics and the server's save check so the two cannot disagree.
 */

export type TransactionIssue =
	/** error: success/failure leads into a block the executor chain also runs */
	| "shared-chain"
	/** error: a transaction inside another one's executor chain on the same connection */
	| "nested-same-connection"
	/** warning: a rollback reachable without passing a transaction's executor */
	| "rollback-outside";

export const TRANSACTION_ERRORS: readonly TransactionIssue[] = [
	"shared-chain",
	"nested-same-connection",
];

type RuleBlock = { id: string; type: string; data?: unknown };
type RuleEdge = { from?: string | null; to?: string | null; fromHandle?: string | null };

/** edges persist the handle as `<blockId>-<kind>`; agent-built ones may say just `<kind>` */
const isHandle = (blockId: string, handle: string | null | undefined, kind: string) =>
	handle === kind || handle === `${blockId}-${kind}`;

/** a literal connection id; `js:` ones are only known at run time */
export function literalConnection(data: unknown) {
	const raw = (data as { connection?: unknown } | null | undefined)?.connection;
	return typeof raw === "string" && raw && !raw.startsWith("js:") ? raw : "";
}

function groupBy(edges: RuleEdge[], key: (edge: RuleEdge) => string | null | undefined) {
	const map = new Map<string, RuleEdge[]>();
	for (const edge of edges) {
		const k = key(edge);
		if (!edge.from || !edge.to || !k) continue;
		const list = map.get(k);
		if (list) list.push(edge);
		else map.set(k, [edge]);
	}
	return map;
}

/**
 * Walks over the wiring:
 * - a transaction's success/failure path must not lead into a block its own
 *   executor chain also reaches (on the transaction);
 * - a transaction inside another one's executor chain must use a different
 *   connection (on the inner one);
 * - walking back from a rollback, every path must enter a transaction's
 *   executor handle before it reaches a block with no incoming edge (the
 *   entrypoint, the error handler); otherwise it can run outside one.
 */
export function findTransactionIssues(
	blocks: RuleBlock[],
	edges: RuleEdge[],
): { blockId: string; issue: TransactionIssue }[] {
	const connection = new Map(
		blocks
			.filter((b) => b.type === BlockTypes.db_transaction)
			.map((b) => [b.id, literalConnection(b.data)]),
	);
	const rollbacks = blocks.filter((b) => b.type === BlockTypes.db_rollback);
	if (connection.size === 0 && rollbacks.length === 0) return [];

	const incoming = groupBy(edges, (e) => e.to);
	const outgoing = groupBy(edges, (e) => e.from);
	const issues: { blockId: string; issue: TransactionIssue }[] = [];

	/** every block reachable from the edges leaving `from` on `kind` */
	const reach = (from: string, kind: string) => {
		const seen = new Set<string>();
		const stack = (outgoing.get(from) ?? [])
			.filter((e) => isHandle(from, e.fromHandle, kind))
			.map((e) => e.to as string);
		for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
			if (seen.has(id)) continue;
			seen.add(id);
			for (const edge of outgoing.get(id) ?? []) stack.push(edge.to as string);
		}
		return seen;
	};

	const nested = new Set<string>();
	for (const [tx, own] of connection) {
		const inside = reach(tx, "executor");
		if (inside.size === 0) continue;
		for (const id of inside) {
			if (own && connection.get(id) === own) nested.add(id);
		}
		const after = [...reach(tx, "success"), ...reach(tx, "failure")];
		if (after.some((id) => inside.has(id))) issues.push({ blockId: tx, issue: "shared-chain" });
	}
	for (const id of nested) issues.push({ blockId: id, issue: "nested-same-connection" });

	const escapes = (start: string) => {
		const seen = new Set([start]);
		const stack = [start];
		for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
			const into = incoming.get(id) ?? [];
			if (into.length === 0) return true;
			for (const edge of into) {
				const from = edge.from as string;
				if (connection.has(from) && isHandle(from, edge.fromHandle, "executor")) continue;
				if (!seen.has(from)) {
					seen.add(from);
					stack.push(from);
				}
			}
		}
		return false;
	};
	for (const b of rollbacks) {
		if ((incoming.get(b.id)?.length ?? 0) > 0 && escapes(b.id)) {
			issues.push({ blockId: b.id, issue: "rollback-outside" });
		}
	}
	return issues;
}
