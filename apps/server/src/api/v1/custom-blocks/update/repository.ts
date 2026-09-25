import { and, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type DbTransactionType, db } from "../../../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	routesEntity,
	testSuitesEntity,
	workflowsEntity,
} from "../../../../db/schema";

type UpdateCustomBlockData = Partial<
	Omit<typeof customBlocksListEntity.$inferInsert, "id" | "projectId" | "name">
>;

export async function getCustomBlockById(id: string, tx?: DbTransactionType) {
	const block = await (tx ?? db)
		.select()
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id))
		.limit(1);
	return block[0];
}

// Removed checkCustomBlockNameExist since name is immutable

export async function updateCustomBlock(
	id: string,
	data: UpdateCustomBlockData,
	tx?: DbTransactionType,
) {
	const updated = await (tx ?? db)
		.update(customBlocksListEntity)
		.set(data)
		.where(eq(customBlocksListEntity.id, id))
		.returning();
	return updated[0];
}

const callerBlock = alias(customBlocksListEntity, "caller_block");

/**
 * The live canvases (routes, workflows, normal custom blocks) of the project
 * that use the custom block `name` — what must be cleared before it can become
 * test-only. Custom block names are only unique per project, hence the scoping.
 */
export async function liveCanvasesUsing(projectId: string, name: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.selectDistinct({
			route: routesEntity.name,
			workflow: workflowsEntity.name,
			customBlock: callerBlock.label,
		})
		.from(blocksEntity)
		.leftJoin(routesEntity, eq(routesEntity.id, blocksEntity.routeId))
		.leftJoin(workflowsEntity, eq(workflowsEntity.id, blocksEntity.workflowId))
		.leftJoin(callerBlock, eq(callerBlock.id, blocksEntity.customBlockId))
		.where(
			and(
				eq(blocksEntity.type, name),
				or(
					eq(routesEntity.projectId, projectId),
					eq(workflowsEntity.projectId, projectId),
					and(eq(callerBlock.projectId, projectId), eq(callerBlock.testOnly, false)),
				),
			),
		);
	return rows.map((r) =>
		r.route
			? `route "${r.route}"`
			: r.workflow
				? `workflow "${r.workflow}"`
				: `custom block "${r.customBlock}"`,
	);
}

/** names of the test suites using the block as their setup or teardown */
export async function suitesUsing(blockId: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ name: testSuitesEntity.name })
		.from(testSuitesEntity)
		.where(
			or(eq(testSuitesEntity.setupBlockId, blockId), eq(testSuitesEntity.teardownBlockId, blockId)),
		);
	return rows.map((r) => `"${r.name}"`);
}
