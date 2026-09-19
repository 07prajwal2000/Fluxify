import { and, eq, ilike } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

export async function getKeysList(projectId: string, searchQuery?: string, tx?: DbTransactionType) {
	const conditions = [eq(appConfigEntity.projectId, projectId)];
	if (searchQuery) {
		conditions.push(ilike(appConfigEntity.keyName, `%${searchQuery}%`));
	}
	const query = (tx ?? db)
		.select({ keyName: appConfigEntity.keyName })
		.from(appConfigEntity)
		.where(and(...conditions));
	const result = await query;
	return result;
}
