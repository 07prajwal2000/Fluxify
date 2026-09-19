import { and, eq } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

const updateSchema = createUpdateSchema(appConfigEntity);

export async function updateAppConfig(
	id: number,
	projectId: string,
	data: z.infer<typeof updateSchema>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.update(appConfigEntity)
		.set(data)
		.where(and(eq(appConfigEntity.id, id), eq(appConfigEntity.projectId, projectId)))
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function getConfigById(id: number, projectId: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(appConfigEntity)
		.where(and(eq(appConfigEntity.id, id), eq(appConfigEntity.projectId, projectId)))
		.limit(1);
	return result.length > 0 ? result[0] : null;
}

export async function getConfigByKeyName(
	keyName: string,
	projectId: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({ id: appConfigEntity.id })
		.from(appConfigEntity)
		.where(and(eq(appConfigEntity.keyName, keyName), eq(appConfigEntity.projectId, projectId)))
		.limit(1);
	return result.length > 0 ? result[0] : null;
}
