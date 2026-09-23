import { eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { projectsEntity } from "../../../../db/schema";

const insertProjectSchema = createInsertSchema(projectsEntity);

export async function createProject(
	data: z.infer<typeof insertProjectSchema>,
	tx?: DbTransactionType,
) {
	const project = await (tx ?? db).insert(projectsEntity).values(data).returning();
	return project.length > 0 ? project[0].id : "";
}

export async function isSlugTaken(slug: string, tx?: DbTransactionType) {
	const project = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.slug, slug))
		.limit(1);
	return project.length > 0;
}

export async function checkProjectExists(name: string, tx?: DbTransactionType) {
	const project = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.name, name))
		.limit(1);
	return project.length > 0;
}
