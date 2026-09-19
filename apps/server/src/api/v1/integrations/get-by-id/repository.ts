import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function getIntegrationByID(projectId: string, id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)));
	return result.length > 0 ? result[0] : null;
}
