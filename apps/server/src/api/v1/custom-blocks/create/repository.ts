import { BlockTypes } from "@fluxify/blocks";
import { STARTER_POSITIONS } from "@fluxify/blocks/layout";
import { generateID } from "@fluxify/lib";
import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { blocksEntity, customBlocksListEntity, projectsEntity } from "../../../../db/schema";

export async function createCustomBlock(
	data: typeof customBlocksListEntity.$inferInsert,
	tx?: DbTransactionType,
) {
	const newBlock = await (tx ?? db).insert(customBlocksListEntity).values(data).returning();
	return newBlock[0].id;
}

export async function createDependencies(customBlockId: string, tx?: DbTransactionType) {
	const id1 = generateID();
	const id3 = generateID();

	await (tx ?? db)?.insert(blocksEntity).values([
		{
			id: id1,
			customBlockId,
			type: BlockTypes.entrypoint,
			position: STARTER_POSITIONS.entrypoint,
			data: {},
		},
		{
			id: id3,
			customBlockId,
			type: BlockTypes.errorHandler,
			position: STARTER_POSITIONS.errorHandler,
			data: {
				next: "",
				retryAfterFail: false,
				retryCount: 0,
			},
		},
	]);
}

export async function checkCustomBlockExist(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const exist = await (tx ?? db)
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.where(
			and(eq(customBlocksListEntity.projectId, projectId), eq(customBlocksListEntity.name, name)),
		)
		.limit(1);
	return exist.length > 0;
}

export async function checkProjectExist(id: string, tx?: DbTransactionType) {
	const project = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return project.length > 0;
}
