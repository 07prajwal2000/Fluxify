import { eq } from "drizzle-orm";
import { BlockTypes } from "@fluxify/blocks";
import { generateID } from "@fluxify/lib";
import { db, DbTransactionType } from "../../../../db";
import {
	blocksEntity,
	projectsEntity,
	workflowsEntity,
} from "../../../../db/schema";

export async function insertWorkflow(
	data: typeof workflowsEntity.$inferInsert,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.insert(workflowsEntity)
		.values(data)
		.returning({ id: workflowsEntity.id });
	return row!.id;
}

/**
 * The two blocks every canvas must have exactly one of. A workflow gets no
 * `response` block — nothing is waiting on an answer.
 */
export async function seedDefaultBlocks(
	workflowId: string,
	tx?: DbTransactionType,
) {
	await (tx ?? db).insert(blocksEntity).values([
		{
			id: generateID(),
			workflowId,
			type: BlockTypes.entrypoint,
			position: { x: 0, y: 0 },
			data: {},
		},
		{
			id: generateID(),
			workflowId,
			type: BlockTypes.errorHandler,
			// a block is ~168px wide; less than that overlaps the entrypoint
			position: { x: -240, y: 0 },
			data: { next: "", retryAfterFail: false, retryCount: 0 },
		},
	]);
}

export async function projectExists(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return !!row;
}
