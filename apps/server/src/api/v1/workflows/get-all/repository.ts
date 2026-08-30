import { count, desc, eq, SQL } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { projectsEntity, workflowsEntity } from "../../../../db/schema";

export async function listWorkflows(
	skip: number,
	limit: number,
	filter?: SQL<unknown>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({
			id: workflowsEntity.id,
			name: workflowsEntity.name,
			description: workflowsEntity.description,
			active: workflowsEntity.active,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
			tracingEnabled: workflowsEntity.tracingEnabled,
			recordExecution: workflowsEntity.recordExecution,
			projectId: workflowsEntity.projectId,
			projectName: projectsEntity.name,
			createdAt: workflowsEntity.createdAt,
			updatedAt: workflowsEntity.updatedAt,
		})
		.from(workflowsEntity)
		.leftJoin(projectsEntity, eq(workflowsEntity.projectId, projectsEntity.id))
		.where(filter)
		.orderBy(desc(workflowsEntity.updatedAt))
		.offset(skip)
		.limit(limit);

	const [total] = await (tx ?? db)
		.select({ count: count(workflowsEntity.id) })
		.from(workflowsEntity)
		.where(filter);

	return { result, totalCount: total!.count };
}
