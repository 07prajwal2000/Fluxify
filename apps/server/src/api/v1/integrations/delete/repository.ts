import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function deleteIntegration(projectId: string, id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.delete(integrationsEntity)
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)))
		.returning();
	return result.length;
}
