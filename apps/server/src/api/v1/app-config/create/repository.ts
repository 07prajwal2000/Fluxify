import { and, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { appConfigEntity } from "../../../../db/schema";

const createSchema = createInsertSchema(appConfigEntity);

export async function createAppConfig(data: z.infer<typeof createSchema>, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.insert(appConfigEntity)
		.values({
			...data,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function keyExists(keyName: string, projectId: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select({ id: appConfigEntity.id })
		.from(appConfigEntity)
		.where(and(eq(appConfigEntity.keyName, keyName), eq(appConfigEntity.projectId, projectId)))
		.limit(1);
	return result.length > 0;
}
