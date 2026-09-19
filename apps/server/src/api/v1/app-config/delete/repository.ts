import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

export async function deleteAppConfig(id: number, projectId: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.delete(appConfigEntity)
		.where(and(eq(appConfigEntity.id, id), eq(appConfigEntity.projectId, projectId)))
		.returning();
	return result.length > 0;
}

export async function checkAppConfigExist(id: number, projectId: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select({ id: appConfigEntity.id })
		.from(appConfigEntity)
		.where(and(eq(appConfigEntity.id, id), eq(appConfigEntity.projectId, projectId)))
		.limit(1);
	return result.length === 1;
}
