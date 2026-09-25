import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { projectsEntity } from "../../../../db/schema";

export async function getProjectById(id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return result[0];
}
