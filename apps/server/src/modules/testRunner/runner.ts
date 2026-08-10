import { logger } from "@fluxify/common";
import { and, eq, inArray, type InferSelectModel } from "drizzle-orm";
import { db } from "../../db";
import {
	routesEntity,
	testRunsEntity,
	testSuiteRunsEntity,
	testSuitesEntity,
	type SuiteRunResult,
	type TestRunStatus,
	type TestRunSummary,
} from "../../db/schema";
import { assertOverridesOwned } from "../requestRouter/service";
import {
	buildSuiteRequest,
	evaluateAssertions,
	type AssertionType,
} from "./assertions";
import { compileSuiteRoute } from "./compile";
import { testWorkerPool, type Pool } from "./pool";
import { resolveSuiteConfig } from "./resolve";
import { runSuiteInChild } from "./spawn";
import type { TestBootstrap, TestResult } from "./types";

type Suite = InferSelectModel<typeof testSuitesEntity>;

/** carries the HTTP status #220's endpoint should answer with */
export class TestRunError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
		this.name = "TestRunError";
	}
}

/** injectable so the orchestration can be tested without a child process */
export type RunnerDeps = {
	compile: typeof compileSuiteRoute;
	resolve: typeof resolveSuiteConfig;
	spawn: typeof runSuiteInChild;
	pool: Pool;
};

const defaultDeps: RunnerDeps = {
	compile: compileSuiteRoute,
	resolve: resolveSuiteConfig,
	spawn: runSuiteInChild,
	pool: testWorkerPool,
};

/**
 * Start a run and hand back its id immediately.
 *
 * Everything that can reject the request outright happens here, synchronously:
 * once the caller has a `runId` the only way to report a problem is a row
 * update it has to poll for. In particular the ownership check runs in the
 * PARENT, before any child exists — a check performed inside the sandbox is
 * worthless, since the sandbox is the thing being contained.
 *
 * `done` resolves when the background phase settles. Production ignores it; it
 * exists so a test can await a run instead of polling the database.
 */
export async function startTestRun(
	input: { projectId: string; routeId: string; suiteIds?: string[] },
	deps: Partial<RunnerDeps> = {},
): Promise<{ runId: string; done: Promise<void> }> {
	const { projectId, routeId, suiteIds } = input;

	const [route] = await db
		.select({ id: routesEntity.id, projectId: routesEntity.projectId })
		.from(routesEntity)
		.where(eq(routesEntity.id, routeId));
	if (!route) throw new TestRunError(404, "Route not found");
	if (route.projectId !== projectId) {
		throw new TestRunError(403, "Route belongs to another project");
	}

	const suites = await db
		.select()
		.from(testSuitesEntity)
		.where(
			suiteIds?.length
				? and(
						eq(testSuitesEntity.routeId, routeId),
						inArray(testSuitesEntity.id, suiteIds),
					)
				: eq(testSuitesEntity.routeId, routeId),
		);
	if (suites.length === 0) {
		throw new TestRunError(404, "No test suites found for this route");
	}

	for (const suite of suites) {
		const denied = assertOverridesOwned(projectId, {
			integrations: suite.integrationOverrides ?? [],
			appConfigs: suite.appConfigOverrides ?? [],
		});
		// one foreign integration fails the whole run: a partially-run fleet whose
		// remaining suites were rejected is harder to read than a clean refusal
		if (denied) {
			throw new TestRunError(
				403,
				`Test suite "${suite.name}" names an integration from another project`,
				denied.data,
			);
		}
	}

	const [run] = await db
		.insert(testRunsEntity)
		.values({ projectId, routeId, totalSuites: suites.length })
		.returning({ id: testRunsEntity.id });

	const suiteRuns = await db
		.insert(testSuiteRunsEntity)
		.values(
			suites.map((suite) => ({
				testRunId: run!.id,
				projectId,
				routeId,
				testSuiteId: suite.id,
			})),
		)
		.returning({ id: testSuiteRunsEntity.id, testSuiteId: testSuiteRunsEntity.testSuiteId });

	const byId = new Map(suiteRuns.map((r) => [r.testSuiteId, r.id]));
	const work = suites.map((suite) => ({
		suite,
		suiteRunId: byId.get(suite.id)!,
	}));

	return {
		runId: run!.id,
		done: executeRun(run!.id, routeId, projectId, work, {
			...defaultDeps,
			...deps,
		}),
	};
}

/**
 * The background half: compile once, then run every suite through the pool,
 * writing each row as it settles so a polling UI sees progress.
 *
 * Nothing throws out of here. An unhandled rejection in a fire-and-forget task
 * leaves the parent row on `running` and the UI polling until the next restart.
 */
async function executeRun(
	runId: string,
	routeId: string,
	projectId: string,
	work: Array<{ suite: Suite; suiteRunId: string }>,
	deps: RunnerDeps,
): Promise<void> {
	try {
		// ONE compile for the whole fleet: it reads the live blocks/edges tables,
		// so compiling per suite would be the same work N times — and could hand
		// two suites of one run different code if the route were edited mid-run.
		const compiled = await deps.compile(routeId);

		await db
			.update(testRunsEntity)
			.set({ status: "running", startedAt: new Date() })
			.where(eq(testRunsEntity.id, runId));

		const startedAt = Date.now();
		const statuses = await Promise.all(
			work.map(({ suite, suiteRunId }) =>
				deps.pool.run(async () => {
					const status = await runOneSuite(
						suiteRunId,
						suite,
						projectId,
						compiled,
						deps,
					);
					return [suite.id, status] as const;
				}),
			),
		);

		const passed = statuses.filter(([, s]) => s === "passed").length;
		const summary: TestRunSummary = {
			total: statuses.length,
			passed,
			failed: statuses.length - passed,
			suites: Object.fromEntries(statuses),
		};

		await db
			.update(testRunsEntity)
			.set({
				status: passed === statuses.length ? "passed" : "failed",
				passedCount: passed,
				failedCount: summary.failed,
				result: summary,
				durationMs: Date.now() - startedAt,
				finishedAt: new Date(),
			})
			.where(eq(testRunsEntity.id, runId));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`[test-runner] run ${runId} failed: ${message}`, "TEST_RUNNER");
		await failRun(runId, message).catch(() => {
			// the database is the only place a failure can be reported; if that is
			// gone too, the boot sweep picks the row up on the next restart
		});
	}
}

/** mark the run and every suite that never settled as `error` */
async function failRun(runId: string, message: string) {
	const finishedAt = new Date();
	await db
		.update(testSuiteRunsEntity)
		.set({
			status: "error",
			finishedAt,
			result: { success: false, result: [], error: message },
		})
		.where(
			and(
				eq(testSuiteRunsEntity.testRunId, runId),
				inArray(testSuiteRunsEntity.status, ["queued", "running"]),
			),
		);

	await db
		.update(testRunsEntity)
		.set({
			status: "error",
			finishedAt,
			result: { total: 0, passed: 0, failed: 0, suites: {}, error: message },
		})
		.where(eq(testRunsEntity.id, runId));
}

/**
 * One suite: resolve its own config, run it in a fresh process, judge the
 * response here in the parent, and write the row.
 *
 * Config resolution is per suite even though the compile is shared — overrides
 * live on the suite, so two suites of one fleet legitimately talk to different
 * databases.
 */
async function runOneSuite(
	suiteRunId: string,
	suite: Suite,
	projectId: string,
	compiled: Awaited<ReturnType<typeof compileSuiteRoute>>,
	deps: RunnerDeps,
): Promise<TestRunStatus> {
	const startedAt = Date.now();
	await db
		.update(testSuiteRunsEntity)
		.set({ status: "running", startedAt: new Date(startedAt) })
		.where(eq(testSuiteRunsEntity.id, suiteRunId));

	let status: TestRunStatus = "error";
	let result: SuiteRunResult;
	let durationMs = 0;

	try {
		const config = await deps.resolve(projectId, {
			appConfigOverrides: suite.appConfigOverrides,
			integrationOverrides: suite.integrationOverrides,
		});
		const request = buildSuiteRequest(suite, compiled.route);
		const bootstrap: TestBootstrap = {
			suiteRunId,
			projectId,
			route: {
				id: compiled.route.id,
				projectName: compiled.route.projectName ?? "",
				bodySchema: compiled.route.bodySchema,
				querySchema: compiled.route.querySchema,
				paramsSchema: compiled.route.paramsSchema,
			},
			source: compiled.source,
			customBlocks: compiled.customBlocks,
			config,
			request,
			timeoutMs: compiled.route.timeoutSeconds * 1_000,
		};

		const response: TestResult = await deps.spawn(bootstrap);
		durationMs = response.durationMs;

		if (response.ok) {
			const verdict = await evaluateAssertions(
				(suite.assertions as AssertionType[]) || [],
				{
					status: response.status,
					body: response.data,
					headers: response.headers,
					durationMs,
					request,
				},
			);
			status = verdict.success ? "passed" : "failed";
			result = {
				...verdict,
				statusCode: response.status,
				headers: response.headers,
			};
		} else {
			// a killed process has no partial verdicts to report — the duration and
			// the reason are all that honestly exist
			status = response.timedOut ? "timeout" : "error";
			result = { success: false, result: [], error: response.error };
		}
	} catch (error) {
		durationMs = Date.now() - startedAt;
		const message = error instanceof Error ? error.message : String(error);
		status = "error";
		result = { success: false, result: [], error: message };
	}

	await db
		.update(testSuiteRunsEntity)
		.set({ status, result, durationMs, finishedAt: new Date() })
		.where(eq(testSuiteRunsEntity.id, suiteRunId));

	return status;
}
