import {
	findTransactionIssues,
	literalConnection,
	type TransactionIssue,
} from "@fluxify/blocks/transactionRules";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { BlockData, CanvasGraph } from "../types";
import { isBlank } from "./dbConditionIssues";
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

/** a blank setting means the default; anything else must be a whole number in range */
const whole = (value: unknown, min: number, max: number) =>
	isBlank(value) ||
	(Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max);

/** the transaction's own settings, checked the way the server's save does */
export function checkTransactionSettings(
	data: BlockData,
	report: (severity: DiagnosticSeverity, message: string, tab?: string) => void,
) {
	if (isBlank(data.executor)) {
		report("warning", "The transaction script is empty, so this block does nothing.");
	}
	if (!whole(data.timeoutMs, 1, Number.MAX_SAFE_INTEGER)) {
		report("error", "Timeout must be a whole number of milliseconds above 0.", "General");
	}
	if (!whole(data.retries, 0, 10)) {
		report("error", "Retries must be a whole number from 0 to 10.", "General");
	}
}
