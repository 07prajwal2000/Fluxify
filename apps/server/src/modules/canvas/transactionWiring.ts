import { findTransactionIssues, TRANSACTION_ERRORS } from "@fluxify/blocks";
import { BadRequestError } from "../../errors/badRequestError";

const MESSAGES = {
	"shared-chain": "its success or failure path leads into blocks its executor chain also runs",
	"nested-same-connection":
		"it runs inside another transaction on the same connection, which is not supported",
} as const;

type Block = { id: string; type: string | null; data?: unknown };
type Edge = { from?: string | null; to?: string | null; fromHandle?: string | null };

/**
 * Refuses the transaction wiring that can never run correctly. The editor shows
 * the same rules as diagnostics; this protects every other canvas writer (the AI
 * harness, the API). A rollback outside a transaction is only a warning there,
 * so a half-built canvas still saves.
 */
export function assertTransactionWiring(blocks: Block[], edges: Edge[]) {
	const typed = blocks.filter((b): b is Block & { type: string } => !!b.type);
	const names = new Map(typed.map((b) => [b.id, blockLabel(b)]));
	const errors = findTransactionIssues(typed, edges).filter(({ issue }) =>
		TRANSACTION_ERRORS.includes(issue),
	);
	if (errors.length === 0) return;
	throw new BadRequestError(
		errors
			.map(({ blockId, issue }) => {
				const reason = MESSAGES[issue as keyof typeof MESSAGES];
				return `Transaction ${names.get(blockId)}: ${reason}.`;
			})
			.join(" "),
	);
}

function blockLabel(block: Block & { type: string }) {
	const name = (block.data as { blockName?: unknown } | null | undefined)?.blockName;
	return typeof name === "string" && name ? `"${name}" (${block.id})` : block.id;
}
