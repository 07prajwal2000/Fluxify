import { eq, ilike, or } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { projectsEntity } from "../../../../db/schema";

const updateRouteSchema = createUpdateSchema(projectsEntity);

export async function updateProject(
	data: z.infer<typeof updateRouteSchema>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.update(projectsEntity)
		.set(data)
		.where(eq(projectsEntity.id, data.id!))
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function getProjectByIdName(id: string, name: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(or(ilike(projectsEntity.name, name), eq(projectsEntity.id, id)));
	return result;
}
