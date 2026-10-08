import { asc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { routesEntity, testSuitesEntity, workflowsEntity } from "../../../../db/schema";

/** every suite whose route or workflow belongs to the project */
export async function getProjectTestSuites(projectId: string) {
	const columns = {
		id: testSuitesEntity.id,
		name: testSuitesEntity.name,
		description: testSuitesEntity.description,
	};
	const [routeSuites, workflowSuites] = await Promise.all([
		db
			.select({ ...columns, targetId: routesEntity.id, targetName: routesEntity.name })
			.from(testSuitesEntity)
			.innerJoin(routesEntity, eq(testSuitesEntity.routeId, routesEntity.id))
			.where(eq(routesEntity.projectId, projectId))
			.orderBy(asc(testSuitesEntity.createdAt)),
		db
			.select({ ...columns, targetId: workflowsEntity.id, targetName: workflowsEntity.name })
			.from(testSuitesEntity)
			.innerJoin(workflowsEntity, eq(testSuitesEntity.workflowId, workflowsEntity.id))
			.where(eq(workflowsEntity.projectId, projectId))
			.orderBy(asc(testSuitesEntity.createdAt)),
	]);
	return [
		...routeSuites.map((s) => ({ ...s, targetType: "route" as const })),
		...workflowSuites.map((s) => ({ ...s, targetType: "workflow" as const })),
	];
}
