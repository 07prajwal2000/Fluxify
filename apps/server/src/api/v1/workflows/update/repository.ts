import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { workflowsEntity } from "../../../../db/schema";

export async function updateWorkflowRow(
	id: string,
	data: Partial<typeof workflowsEntity.$inferInsert>,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.update(workflowsEntity)
		.set(data)
		.where(eq(workflowsEntity.id, id))
		.returning();
	return row;
}
