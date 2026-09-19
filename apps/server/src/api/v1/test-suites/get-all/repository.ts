import { asc, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";

export async function getAllTestSuites(routeId: string, tx?: DbTransactionType) {
	return await (tx ?? db)
		.select()
		.from(testSuitesEntity)
		.where(eq(testSuitesEntity.routeId, routeId))
		.orderBy(asc(testSuitesEntity.createdAt));
}
