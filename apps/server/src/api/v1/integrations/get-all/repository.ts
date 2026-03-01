import { db, DbTransactionType } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";
import { eq, sql, and, or, SQL, desc, like } from "drizzle-orm";

export async function getAllIntegrationsByGroup(
	group: string,
	tags?: string[],
	tx?: DbTransactionType,
) {
	let condition: SQL = eq(integrationsEntity.group, group);

	if (tags && tags.length > 0) {
		const tagConditions = tags.map((t) =>
			like(integrationsEntity.tags, `%${t}%`),
		);
		condition = and(condition, or(...tagConditions))!;
	}

	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(condition)
		.orderBy(desc(integrationsEntity.createdAt));

	return result;
}
