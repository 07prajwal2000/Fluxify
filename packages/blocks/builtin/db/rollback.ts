import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const rollbackDbBlockSchema = z
	.object({
		message: z
			.union([z.string(), z.number()])
			.optional()
			.describe("reason handed to the transaction's failure chain (supports js expression)"),
	})
	.extend(baseBlockDataSchema.shape);

export const rollbackDbAiDescription = {
	name: BlockTypes.db_rollback,
	description:
		"Rolls back the enclosing database transaction and stops its executor chain; the transaction then runs its 'failure' handle. Only valid inside a transaction's executor chain.",
	jsonSchema: JSON.stringify(z.toJSONSchema(rollbackDbBlockSchema)),
	handleInfo: `
Handles: none — terminal. Handle what follows on the transaction's 'failure' handle.`,
};

/** terminal — unwinds to the enclosing `lib.dbTransaction`, which rolls back */
export function emitRollbackDb(node: EmitNode) {
	const { message } = rollbackDbBlockSchema.parse(node.block.data);
	return `throw new lib.TransactionRollback(String(${node.value(message || "transaction rolled back")}));`;
}
