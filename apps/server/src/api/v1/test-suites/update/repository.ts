import { and, eq, type InferInsertModel, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { customBlocksListEntity, routesEntity, testSuitesEntity } from "../../../../db/schema";

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

/** which of `ids` are test-only custom blocks of the route's project */
export async function testOnlyBlocksOfRoute(routeId: string, ids: string[]) {
	const rows = await db
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.innerJoin(routesEntity, eq(routesEntity.projectId, customBlocksListEntity.projectId))
		.where(
			and(
				eq(routesEntity.id, routeId),
				inArray(customBlocksListEntity.id, ids),
				eq(customBlocksListEntity.testOnly, true),
			),
		);
	return new Set(rows.map((r) => r.id));
}
