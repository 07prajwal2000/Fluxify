import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity } from "../../../../db/schema";

/**
 * Clears the run history for one route. Scoped by project AND route, so a route
 * id from another project deletes nothing.
 *
 * The child `test_suite_runs` rows cascade with the parent — see the foreign key
 * in `db/schema.ts`.
 */
export async function deleteTestRuns(projectId: string, routeId: string) {
	const deleted = await db
		.delete(testRunsEntity)
		.where(
			and(
				eq(testRunsEntity.projectId, projectId),
				eq(testRunsEntity.routeId, routeId),
			),
		)
		.returning({ id: testRunsEntity.id });

	return deleted.length;
}
