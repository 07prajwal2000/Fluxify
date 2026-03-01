import { db, DbTransactionType } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export async function updateIntegration(
	id: string,
	data: { name: string; config: any; tags?: string[] },
	tx?: DbTransactionType,
): Promise<any> {
	console.log(data);

	const result = await (tx ?? db)
		.update(integrationsEntity)
		.set({
			name: data.name,
			config: data.config,
			tags: data.tags ? data.tags.join(",") : undefined,
		})
		.where(eq(integrationsEntity.id, id))
		.returning();
	return result;
}

export async function integrationExistByName(
	name: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({ id: integrationsEntity.id })
		.from(integrationsEntity)
		.where(eq(integrationsEntity.name, name));
	return result[0];
}

export async function getIntegrationById(id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(eq(integrationsEntity.id, id));
	return result.length > 0 ? result[0] : null;
}
