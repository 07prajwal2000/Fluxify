import { and, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity, integrationsEntity } from "../../../../db/schema";

const schema = createInsertSchema(integrationsEntity);

export async function createIntegration(data: z.infer<typeof schema>, tx?: DbTransactionType) {
	const result = await (tx ?? db).insert(integrationsEntity).values(data);
	return result;
}

export async function integrationExistByName(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.name, name), eq(integrationsEntity.projectId, projectId)))
		.limit(1);
	return result.length > 0;
}

export async function getAppConfigKeys(projectId: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select({ key: appConfigEntity.keyName })
		.from(appConfigEntity)
		.where(eq(appConfigEntity.projectId, projectId));
	return result.map((item) => item.key);
}
