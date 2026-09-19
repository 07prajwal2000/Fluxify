import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function getIntegrationById(projectId: string, id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)));
	return result[0];
}
