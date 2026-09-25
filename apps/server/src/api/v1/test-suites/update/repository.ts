import { and, eq, type InferInsertModel, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { customBlocksListEntity, testSuitesEntity } from "../../../../db/schema";

export async function updateTestSuite(
	id: string,
	updateData: Partial<InferInsertModel<typeof testSuitesEntity>>,
	tx?: DbTransactionType,
) {
	const [result] = await (tx ?? db)
		.update(testSuitesEntity)
		.set(updateData)
		.where(eq(testSuitesEntity.id, id))
		.returning();
	return result;
}

/** which of `ids` are test-only custom blocks of the project */
export async function testOnlyBlocksOfProject(projectId: string, ids: string[]) {
	if (ids.length === 0) return new Set<string>();
	const rows = await db
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.where(
			and(
				eq(customBlocksListEntity.projectId, projectId),
				inArray(customBlocksListEntity.id, ids),
				eq(customBlocksListEntity.testOnly, true),
			),
		);
	return new Set(rows.map((r) => r.id));
}
