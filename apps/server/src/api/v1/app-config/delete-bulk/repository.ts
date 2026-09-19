import { and, eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

export async function deleteAppConfigBulk(
	ids: number[],
	projectId: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.delete(appConfigEntity)
		.where(and(inArray(appConfigEntity.id, ids), eq(appConfigEntity.projectId, projectId)))
		.returning();
	return result.length;
}

export async function checkAppConfigsExist(
	ids: number[],
	projectId: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({ id: appConfigEntity.id })
		.from(appConfigEntity)
		.where(and(inArray(appConfigEntity.id, ids), eq(appConfigEntity.projectId, projectId)));
	return result.length === ids.length;
}
