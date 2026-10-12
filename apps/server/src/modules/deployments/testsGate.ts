import { eq, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import {
	type CanvasSnapshot,
	type CaseResult,
	type GateRef,
	type GateResult,
	testSuiteRunsEntity,
	testSuitesEntity,
} from "../../db/schema";
import { prodUsers } from "../references/closure";
import { loadProdGraph } from "../references/prodGraph";
import { startTestRun, TestRunError } from "../testRunner/runner";
import { targetColumn } from "../testRunner/target";
import { readSnapshot } from "../versions/repository";
import type { GateTarget } from "./gates";

/**
 * The tests gate (#739), the last one. For a route or workflow, every suite of
 * it runs against a candidate compiled in memory from the version being
 * promoted, with development values.
 *
 * For a custom block or middleware (#740) the users are tested: every route and
 * workflow whose promoted version runs it, directly or through other blocks and
 * middlewares, runs its own suites against its promoted graph with the
 * candidate swapped in. So do the suites that use it as a setup, teardown or
 * loader hook. Any suite that does not pass fails the promote.
 *
 * It can take as long as the suites do, so a deployment waits `pending` for it
 * (see `deployVersion`).
 */

export const NO_SUITES = "No test suites: promoted without tests";
export const NOT_USED_YET = "Not used in production yet";

/** one route or workflow whose suites the gate runs */
export type PlannedRun = {
	kind: "route" | "workflow";
	id: string;
	name: string;
	/** the version of that route or workflow the suites run against */
	versionId: string;
	/** the suites to run; every suite of it when absent */
	suiteIds?: string[];
	/** the version's snapshot; read when the run starts when absent */
	snapshot?: CanvasSnapshot;
};

export type TestsPlan = {
	/** the routes and workflows that use what is being promoted, tests or not */
	users: number;
	runs: PlannedRun[];
};

export async function countSuites(kind: "route" | "workflow", id: string) {
	const rows = await db
		.select({ id: testSuitesEntity.id })
		.from(testSuitesEntity)
		.where(eq(targetColumn(testSuitesEntity, kind), id));
	return rows.length;
}

const isBlock = (kind: GateTarget["kind"]) => kind === "custom_block" || kind === "middleware";

/** Which suites the gate will run, so the request knows whether it will have to wait. */
export async function planTests(target: GateTarget): Promise<TestsPlan> {
	if (target.kind === "route" || target.kind === "workflow") {
		const suites = await countSuites(target.kind, target.id);
		const run: PlannedRun = {
			kind: target.kind,
			id: target.id,
			name: target.id,
			versionId: target.versionId,
			snapshot: target.snapshot as CanvasSnapshot,
		};
		return { users: 1, runs: suites ? [run] : [] };
	}

	const graph = await loadProdGraph(target.projectId);
	const subject =
		target.kind === "custom_block"
			? graph.blocksById.get(target.id)
			: graph.middlewares.get(target.id);
	const users = prodUsers(graph, {
		kind: target.kind,
		id: target.id,
		name: subject?.name ?? target.id,
	});

	const wanted = new Map<string, PlannedRun>();
	for (const entry of users.targets) {
		if (entry.kind !== "route" && entry.kind !== "workflow") continue;
		wanted.set(`${entry.kind}:${entry.id}`, {
			kind: entry.kind,
			id: entry.id,
			name: entry.name,
			versionId: entry.versionId,
		});
	}
	for (const suite of users.hookSuites) {
		const key = `${suite.target.kind}:${suite.target.id}`;
		const existing = wanted.get(key);
		if (!existing) {
			wanted.set(key, {
				kind: suite.target.kind,
				id: suite.target.id,
				name: suite.target.name,
				versionId: suite.target.prodVersionId!,
				suiteIds: [suite.id],
			});
		} else if (existing.suiteIds) existing.suiteIds.push(suite.id);
	}

	// a user with no suites has nothing to run
	const all = [...wanted.values()];
	const ids = (kind: PlannedRun["kind"]) => all.filter((run) => run.kind === kind).map((r) => r.id);
	const withSuites = new Set<string>();
	if (all.length) {
		const conditions = [
			ids("route").length ? inArray(testSuitesEntity.routeId, ids("route")) : undefined,
			ids("workflow").length ? inArray(testSuitesEntity.workflowId, ids("workflow")) : undefined,
		].filter((c) => c !== undefined);
		const rows = await db
			.select({ routeId: testSuitesEntity.routeId, workflowId: testSuitesEntity.workflowId })
			.from(testSuitesEntity)
			.where(or(...conditions));
		for (const row of rows) withSuites.add(row.routeId ?? row.workflowId!);
	}
	return { users: all.length, runs: all.filter((run) => withSuites.has(run.id)) };
}

/** why one case did not pass: its own error, else its first failed check */
const caseReason = (c: CaseResult) =>
	c.error ?? c.checks.find((check) => !check.success)?.message ?? c.status;

type Outcome = {
	total: number;
	failed: number;
	items: string[];
	refs: GateRef[];
	noWorker?: string;
	runId: string;
};

/** What a finished run says about each suite: the failing ones, and why. */
async function outcomeOf(run: PlannedRun, runId: string): Promise<Outcome> {
	const rows = await db
		.select({
			status: testSuiteRunsEntity.status,
			result: testSuiteRunsEntity.result,
			name: testSuitesEntity.name,
		})
		.from(testSuiteRunsEntity)
		.leftJoin(testSuitesEntity, eq(testSuitesEntity.id, testSuiteRunsEntity.testSuiteId))
		.where(eq(testSuiteRunsEntity.testRunId, runId));

	const outcome: Outcome = { total: rows.length, failed: 0, items: [], refs: [], runId };
	for (const row of rows) {
		if (row.status === "passed") continue;
		outcome.failed++;
		const name = row.name ?? "(deleted suite)";
		const result = row.result;
		const failing = (result?.cases ?? []).filter((c) => c.status !== "passed");
		const reasons = failing.map((c) => `case "${c.name}" ${c.status}: ${caseReason(c)}`);
		if (!reasons.length) {
			const reason =
				result?.error ?? result?.result.find((check) => !check.success)?.message ?? row.status;
			if (reason.startsWith("No development worker")) outcome.noWorker = reason;
			reasons.push(reason);
		}
		for (const reason of reasons) outcome.items.push(`${name}: ${reason}`);
		outcome.refs.push({
			kind: run.kind,
			id: run.id,
			name: run.name,
			suite: name,
			reason: reasons[0],
			runId,
		});
	}
	return outcome;
}

export async function testsGate(
	target: GateTarget,
	deploymentId: string,
	/** an earlier gate failed: the suites would only be noise */
	skip = false,
	plan?: TestsPlan,
): Promise<GateResult> {
	if (skip) {
		return { gate: "tests", status: "skipped", message: "Not run: an earlier check failed" };
	}
	const { users, runs } = plan ?? (await planTests(target));
	const block = isBlock(target.kind);
	if (block && users === 0) {
		return { gate: "tests", status: "warning", message: NOT_USED_YET };
	}
	if (runs.length === 0) {
		return {
			gate: "tests",
			status: "warning",
			message: block
				? "No test suites to run: the routes and workflows that use it in production have none"
				: NO_SUITES,
		};
	}

	const outcomes: Outcome[] = [];
	for (const run of runs) {
		try {
			const snapshot = run.snapshot ?? (await readSnapshot(run.versionId));
			if (!snapshot) throw new Error(`The promoted version of "${run.name}" is gone`);
			const started = await startTestRun({
				projectId: target.projectId,
				target: { type: run.kind, id: run.id },
				suiteIds: run.suiteIds,
				env: "production",
				candidate: {
					versionId: run.versionId,
					snapshot,
					// the users run what production runs, with the candidate in its place
					swap: block
						? {
								kind: target.kind as "custom_block" | "middleware",
								id: target.id,
								snapshot: target.snapshot,
							}
						: undefined,
				},
				deploymentId,
			});
			await started.done;
			outcomes.push(await outcomeOf(run, started.runId));
		} catch (error) {
			const message =
				error instanceof TestRunError || error instanceof Error ? error.message : String(error);
			return { gate: "tests", status: "failed", message: `The tests could not run: ${message}` };
		}
	}

	const total = outcomes.reduce((sum, o) => sum + o.total, 0);
	const failed = outcomes.reduce((sum, o) => sum + o.failed, 0);
	if (failed === 0) {
		return {
			gate: "tests",
			status: "passed",
			message: `${total} test suite${total === 1 ? "" : "s"} passed`,
		};
	}
	const label = (o: Outcome, i: number) => (block ? `${runs[i]!.kind} "${runs[i]!.name}" > ` : "");
	const first = outcomes.find((o) => o.failed > 0)!;
	return {
		gate: "tests",
		status: "failed",
		message:
			outcomes.find((o) => o.noWorker)?.noWorker ??
			`${failed} of ${total} test suites did not pass`,
		items: outcomes.flatMap((o, i) => o.items.map((item) => `${label(o, i)}${item}`)),
		refs: block ? outcomes.flatMap((o) => o.refs) : undefined,
		// so the promotion panel can link straight to the failed checks (#739)
		runId: first.runId,
	};
}
