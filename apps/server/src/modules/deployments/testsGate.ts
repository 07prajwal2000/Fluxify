import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	type CaseResult,
	type GateResult,
	testSuiteRunsEntity,
	testSuitesEntity,
} from "../../db/schema";
import { startTestRun, TestRunError } from "../testRunner/runner";
import { targetColumn } from "../testRunner/target";
import type { GateTarget } from "./gates";

/**
 * The tests gate (#739), the last one: every suite of the route or workflow runs
 * against a candidate compiled in memory from the version being promoted, with development
 * values. Any suite that does not pass fails the promote. It can take as long as
 * the suites do, so a deployment waits `pending` for it (see `deployVersion`).
 */

export const NO_SUITES = "No test suites: promoted without tests";

export async function countSuites(kind: GateTarget["kind"], id: string) {
	const rows = await db
		.select({ id: testSuitesEntity.id })
		.from(testSuitesEntity)
		.where(eq(targetColumn(testSuitesEntity, kind), id));
	return rows.length;
}

/** why one case did not pass: its own error, else its first failed check */
const caseReason = (c: CaseResult) =>
	c.error ?? c.checks.find((check) => !check.success)?.message ?? c.status;

export async function testsGate(
	target: GateTarget,
	deploymentId: string,
	/** an earlier gate failed: the suites would only be noise */
	skip = false,
): Promise<GateResult> {
	if (skip) {
		return { gate: "tests", status: "skipped", message: "Not run: an earlier check failed" };
	}
	if ((await countSuites(target.kind, target.id)) === 0) {
		return { gate: "tests", status: "warning", message: NO_SUITES };
	}

	let runId: string;
	try {
		const started = await startTestRun({
			projectId: target.projectId,
			target: { type: target.kind, id: target.id },
			env: "production",
			candidate: { versionId: target.versionId, snapshot: target.snapshot },
			deploymentId,
		});
		runId = started.runId;
		await started.done;
	} catch (error) {
		const message =
			error instanceof TestRunError || error instanceof Error ? error.message : String(error);
		return { gate: "tests", status: "failed", message: `The tests could not run: ${message}` };
	}

	const rows = await db
		.select({
			status: testSuiteRunsEntity.status,
			result: testSuiteRunsEntity.result,
			name: testSuitesEntity.name,
		})
		.from(testSuiteRunsEntity)
		.leftJoin(testSuitesEntity, eq(testSuitesEntity.id, testSuiteRunsEntity.testSuiteId))
		.where(eq(testSuiteRunsEntity.testRunId, runId));

	const items: string[] = [];
	let noWorker: string | undefined;
	for (const row of rows) {
		if (row.status === "passed") continue;
		const name = row.name ?? "(deleted suite)";
		const result = row.result;
		const failing = (result?.cases ?? []).filter((c) => c.status !== "passed");
		if (failing.length) {
			for (const c of failing)
				items.push(`${name}: case "${c.name}" ${c.status}: ${caseReason(c)}`);
			continue;
		}
		const reason =
			result?.error ?? result?.result.find((check) => !check.success)?.message ?? row.status;
		if (reason.startsWith("No development worker")) noWorker = reason;
		items.push(`${name}: ${reason}`);
	}

	const failed = rows.filter((row) => row.status !== "passed").length;
	if (failed === 0) {
		return {
			gate: "tests",
			status: "passed",
			message: `${rows.length} test suite${rows.length === 1 ? "" : "s"} passed`,
		};
	}
	return {
		gate: "tests",
		status: "failed",
		message: noWorker ?? `${failed} of ${rows.length} test suites did not pass`,
		items,
		// so the promotion panel can link straight to the failed checks (#739)
		runId,
	};
}
