import { db, DbTransactionType } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";
import { count, ilike, asc, desc } from "drizzle-orm";

export async function getAppConfigList(
  skip: number,
  take: number,
  search?: string,
  sort: "asc" | "desc" = "desc",
  sortBy: keyof typeof appConfigEntity = "updatedAt",
  tx?: DbTransactionType
) {
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
    .from(appConfigEntity);

  if (search) {
    query.where(ilike(appConfigEntity.keyName, `%${search}%`));
  }

  const result = await query
    .orderBy(
      sort === "asc"
        ? asc(appConfigEntity[sortBy] as any)
        : desc(appConfigEntity[sortBy] as any)
    )
    .offset(skip)
    .limit(take);

  const totalCount = await getAppConfigCount(search, tx);

  return { result, totalCount };
}

export async function getAppConfigCount(
  search?: string,
  tx?: DbTransactionType
) {
  const query = (tx ?? db)
    .select({
      count: count(appConfigEntity.id),
    })
    .from(appConfigEntity);

  if (search) {
    query.where(ilike(appConfigEntity.keyName, `%${search}%`));
  }

  const result = await query;
  return result[0].count;
}
