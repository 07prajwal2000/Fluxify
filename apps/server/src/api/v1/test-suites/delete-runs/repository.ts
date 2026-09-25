import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";

/**
 * Clears the run history for one route or workflow. Scoped by project AND target, so a target
 * id from another project deletes nothing.
 *
 * The child `test_suite_runs` rows cascade with the parent — see the foreign key
 * in `db/schema.ts`.
 */
export async function deleteTestRuns(projectId: string, target: SuiteTarget) {
	const deleted = await db
		.delete(testRunsEntity)
		.where(
			and(
				eq(testRunsEntity.projectId, projectId),
				eq(targetColumn(testRunsEntity, target.type), target.id),
			),
		)
		.returning({ id: testRunsEntity.id });

	return deleted.length;
}
