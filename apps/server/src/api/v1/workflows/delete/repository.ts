import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { workflowsEntity } from "../../../../db/schema";

export async function deleteWorkflowRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(workflowsEntity).where(eq(workflowsEntity.id, id));
}
