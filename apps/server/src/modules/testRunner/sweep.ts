import { inArray } from "drizzle-orm";
import { logger } from "@fluxify/common";
import { db } from "../../db";
import { testRunsEntity, testSuiteRunsEntity } from "../../db/schema";

const STRANDED = ["queued", "running"] as const;
const MESSAGE = "server restarted";

/**
 * The run queue is in-memory, so a restart abandons every row that was still
 * queued or running. Without this sweep the UI polls those rows forever.
 */
export async function sweepStrandedTestRuns() {
	const finishedAt = new Date();

	const suiteRuns = await db
		.update(testSuiteRunsEntity)
		.set({
			status: "error",
			finishedAt,
			result: { success: false, result: [], error: MESSAGE },
		})
		.where(inArray(testSuiteRunsEntity.status, [...STRANDED]))
		.returning({ id: testSuiteRunsEntity.id });

	// Counts live in their own columns; `result` is only a summary blob, so
	// overwriting it with the reason costs nothing and gives the UI a message.
	const runs = await db
		.update(testRunsEntity)
		.set({
			status: "error",
			finishedAt,
			result: { total: 0, passed: 0, failed: 0, suites: {}, error: MESSAGE },
		})
		.where(inArray(testRunsEntity.status, [...STRANDED]))
		.returning({ id: testRunsEntity.id });

	if (runs.length || suiteRuns.length) {
		logger.info(
			`test runner: marked ${runs.length} run(s) and ${suiteRuns.length} suite run(s) as error (${MESSAGE})`,
		);
	}
}
