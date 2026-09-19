import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

export async function getAppConfigList(
	projectId: string,
	skip: number,
	take: number,
	search?: string,
	sort: "asc" | "desc" = "desc",
	sortBy: keyof typeof appConfigEntity = "updatedAt",
	tx?: DbTransactionType,
) {
	const conditions = [eq(appConfigEntity.projectId, projectId)];
	if (search) {
		conditions.push(ilike(appConfigEntity.keyName, `%${search}%`));
	}

	const query = (tx ?? db)
		.select({
			id: appConfigEntity.id,
			keyName: appConfigEntity.keyName,
			isEncrypted: appConfigEntity.isEncrypted,
			dataType: appConfigEntity.dataType,
			encodingType: appConfigEntity.encodingType,
			createdAt: appConfigEntity.createdAt,
			updatedAt: appConfigEntity.updatedAt,
		})
		.from(appConfigEntity)
		.where(and(...conditions));

	const result = await query
		.orderBy(
			sort === "asc" ? asc(appConfigEntity[sortBy] as any) : desc(appConfigEntity[sortBy] as any),
		)
		.offset(skip)
		.limit(take);

	const totalCount = await getAppConfigCount(projectId, search, tx);

	return { result, totalCount };
}

export async function getAppConfigCount(
	projectId: string,
	search?: string,
	tx?: DbTransactionType,
) {
	const conditions = [eq(appConfigEntity.projectId, projectId)];
	if (search) {
		conditions.push(ilike(appConfigEntity.keyName, `%${search}%`));
	}

	const query = (tx ?? db)
		.select({
			count: count(appConfigEntity.id),
		})
		.from(appConfigEntity)
		.where(and(...conditions));

	const result = await query;
	return result[0].count;
}
