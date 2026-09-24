import {
	findTransactionIssues,
	literalConnection,
	type TransactionIssue,
} from "@fluxify/blocks/transactionRules";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic, DiagnosticSeverity } from "./types";

export const TRANSACTION_SOURCE = "transaction-wiring";
export const SHARED_CHAIN =
	"This transaction's success or failure path leads into blocks that also run inside its executor chain. Keep the inside and the after paths separate: give each its own blocks.";
export const NESTED_SAME_CONNECTION =
	"This transaction runs inside another transaction on the same connection, which is not supported: it fails the run. Move it out, or use a different connection.";
export const OUTSIDE_TRANSACTION =
	"This Rollback is reachable outside a Database Transaction, where it fails the run. Place it only in a chain wired to a transaction's executor handle.";

const REPORT: Record<TransactionIssue, { severity: DiagnosticSeverity; message: string }> = {
	"shared-chain": { severity: "error", message: SHARED_CHAIN },
	"nested-same-connection": { severity: "error", message: NESTED_SAME_CONNECTION },
	"rollback-outside": { severity: "warning", message: OUTSIDE_TRANSACTION },
};

/**
 * What the transaction checks depend on: rollback/transaction ids, each
 * transaction's connection, and the wiring.
 * Empty when there is neither, so most canvases never run the walks.
 */
export function transactionTopologyKey(graph: CanvasGraph): string {
	const ids = graph.blocks
		.filter((b) => b.type === BLOCK_TYPES.db_rollback || b.type === BLOCK_TYPES.db_transaction)
		.map((b) => `${b.type}:${b.id}:${literalConnection(b.data)}`);
	if (ids.length === 0) return "";
	return `${ids.join(",")}|${graph.edges.map((e) => `${e.from}>${e.fromHandle}>${e.to}`).join(",")}`;
}

/** the shared transaction wiring rules, as editor diagnostics */
export function validateTransactions(graph: CanvasGraph): BlockDiagnostic[] {
	return findTransactionIssues(graph.blocks, graph.edges).map(({ blockId, issue }) => ({
		blockId,
		...REPORT[issue],
		source: TRANSACTION_SOURCE,
	}));
}
