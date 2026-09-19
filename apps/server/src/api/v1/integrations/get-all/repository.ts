import { and, desc, eq, like, or, type SQL, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function getAllIntegrationsByGroup(
	projectId: string,
	group: string,
	tags?: string[],
	tx?: DbTransactionType,
) {
	let condition: SQL = and(
		eq(integrationsEntity.projectId, projectId),
		eq(integrationsEntity.group, group),
	)!;

	if (tags && tags.length > 0) {
		const tagConditions = tags.map((t) => like(integrationsEntity.tags, `%${t}%`));
		condition = and(condition, or(...tagConditions))!;
	}

	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(condition)
		.orderBy(desc(integrationsEntity.createdAt));

	return result;
}
