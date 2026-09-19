import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function updateIntegration(
	projectId: string,
	id: string,
	data: { name: string; config: any; tags?: string[] },
	tx?: DbTransactionType,
): Promise<any> {
	const result = await (tx ?? db)
		.update(integrationsEntity)
		.set({
			name: data.name,
			config: data.config,
			tags: data.tags ? data.tags.join(",") : undefined,
		})
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)))
		.returning();
	return result;
}

export async function integrationExistByName(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({ id: integrationsEntity.id })
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.name, name), eq(integrationsEntity.projectId, projectId)));
	return result[0];
}

export async function getIntegrationById(projectId: string, id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)));
	return result.length > 0 ? result[0] : null;
}
