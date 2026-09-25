import { logger } from "@fluxify/common";
import { and, eq, type InferSelectModel, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	routesEntity,
	type SuiteRunResult,
	type TestRunStatus,
	type TestRunSummary,
	testRunsEntity,
	testSuiteRunsEntity,
	testSuitesEntity,
} from "../../db/schema";
import { assertOverridesOwned } from "../requestRouter/service";
import { type AssertionType, buildSuiteRequest } from "./assertions";
import { countCases } from "./cases";
import {
	type CompiledSuiteTarget,
	compileInputScript,
	compileSuiteTarget,
	INPUT_SCRIPT_BLOCK,
} from "./compile";
import { runSuiteOnWorker } from "./dispatch";
import { loadSuiteHooks, type SuiteHook } from "./hooks";
import { type Pool, testWorkerPool } from "./pool";
import { resolveSuiteConfig } from "./resolve";
import { type SuiteTarget, targetColumn, targetKeys, targetProject } from "./target";
import type { SuiteInputSpec, TestBootstrap, TestResult } from "./types";

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

/** injectable so the orchestration can be tested without NATS or a worker */
export type RunnerDeps = {
	compile: typeof compileSuiteTarget;
	resolve: typeof resolveSuiteConfig;
	hooks: typeof loadSuiteHooks;
	blockNames: typeof loadBlockNames;
	spawn: typeof runSuiteOnWorker;
	pool: Pool;
};

const defaultDeps: RunnerDeps = {
	compile: compileSuiteTarget,
	resolve: resolveSuiteConfig,
	hooks: loadSuiteHooks,
	blockNames: loadBlockNames,
	spawn: runSuiteOnWorker,
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
	input: { projectId: string; target: SuiteTarget; suiteIds?: string[] },
	deps: Partial<RunnerDeps> = {},
): Promise<{ runId: string; done: Promise<void> }> {
	const { projectId, target, suiteIds } = input;
	const label = target.type === "route" ? "Route" : "Workflow";

	const owner = await targetProject(target);
	if (owner === undefined) throw new TestRunError(404, `${label} not found`);
	if (owner !== projectId) {
		throw new TestRunError(403, `${label} belongs to another project`);
	}

	const ofTarget = eq(targetColumn(testSuitesEntity, target.type), target.id);
	const suites = await db
		.select()
		.from(testSuitesEntity)
		.where(suiteIds?.length ? and(ofTarget, inArray(testSuitesEntity.id, suiteIds)) : ofTarget);
	if (suites.length === 0) {
		throw new TestRunError(404, `No test suites found for this ${target.type}`);
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
		.values({ projectId, ...targetKeys(target), totalSuites: suites.length })
		.returning({ id: testRunsEntity.id });

	const suiteRuns = await db
		.insert(testSuiteRunsEntity)
		.values(
			suites.map((suite) => ({
				testRunId: run!.id,
				projectId,
				...targetKeys(target),
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
		done: executeRun(run!.id, target, projectId, work, {
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
	target: SuiteTarget,
	projectId: string,
	work: Array<{ suite: Suite; suiteRunId: string }>,
	deps: RunnerDeps,
): Promise<void> {
	try {
		// ONE compile for the whole fleet: it reads the live blocks/edges tables,
		// so compiling per suite would be the same work N times — and could hand
		// two suites of one run different code if the target were edited mid-run.
		const compiled = await deps.compile(target);
		const hooks = await deps.hooks(work.map((w) => w.suite.id));
		const names = await deps.blockNames(
			work.flatMap(({ suite }) => [
				suite.setupBlockId,
				suite.teardownBlockId,
				suite.input?.source === "loader" ? (suite.input.loaderBlockId ?? null) : null,
			]),
		);

		await db
			.update(testRunsEntity)
			.set({ status: "running", startedAt: new Date() })
			.where(eq(testRunsEntity.id, runId));

		const startedAt = Date.now();
		const runSuite = ({ suite, suiteRunId }: (typeof work)[number]) =>
			deps.pool.run(async () => {
				const status = await runOneSuite(
					suiteRunId,
					suite,
					projectId,
					compiled,
					{ hooks: hooks.get(suite.id) ?? [], names },
					deps,
				);
				return [suite.id, status] as const;
			});
		// suites share the test databases: "run alone" ones go one by one after the
		// rest, so their setup sees no other suite's rows
		const statuses = await Promise.all(work.filter((w) => !w.suite.runAlone).map(runSuite));
		for (const w of work.filter((w) => w.suite.runAlone)) statuses.push(await runSuite(w));

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
 * One suite: resolve its own config, send it to a worker (which runs it in a
 * fresh process and judges it there), and write the row.
 *
 * Config resolution is per suite even though the compile is shared — overrides
 * live on the suite, so two suites of one fleet legitimately talk to different
 * databases.
 */
async function runOneSuite(
	suiteRunId: string,
	suite: Suite,
	projectId: string,
	compiled: CompiledSuiteTarget,
	{ hooks, names }: { hooks: SuiteHook[]; names: Map<string, string> },
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
		const common = {
			suiteRunId,
			projectId,
			source: compiled.source,
			customBlocks: compiled.customBlocks,
			config,
			assertions: (suite.assertions as AssertionType[]) || [],
			hooks,
			suite: { id: suite.id, name: suite.name },
			setup: phase(names, suite.setupBlockId, suite.setupTimeoutMs),
			teardown: phase(names, suite.teardownBlockId, suite.teardownTimeoutMs),
		};
		let bootstrap: TestBootstrap;
		if (compiled.route) {
			bootstrap = {
				...common,
				route: {
					id: compiled.route.id,
					projectName: compiled.route.projectName ?? "",
					bodySchema: compiled.route.bodySchema,
					querySchema: compiled.route.querySchema,
					paramsSchema: compiled.route.paramsSchema,
				},
				request: buildSuiteRequest(suite, compiled.route),
				timeoutMs: compiled.route.timeoutSeconds * 1_000,
			};
		} else {
			const { input, script } = inputSpec(suite, names, compiled);
			bootstrap = {
				...common,
				customBlocks: script ? [...common.customBlocks, script] : common.customBlocks,
				workflow: { id: compiled.workflow.id, name: compiled.workflow.name },
				input,
				timeoutMs: compiled.workflow.timeoutSeconds * 1_000,
			};
		}

		const response: TestResult = await deps.spawn(bootstrap);
		durationMs = response.durationMs;

		if (response.ok && response.cases) {
			// raw per-case results; the suite passes when every case does (#487)
			status = response.verdict.success ? "passed" : "failed";
			result = {
				...response.verdict,
				cases: response.cases,
				counts: response.counts,
				teardownError: response.teardownError,
			};
		} else if (response.ok) {
			status = response.verdict.success ? "passed" : "failed";
			result = {
				...response.verdict,
				actualData: response.data,
				statusCode: response.status,
				headers: response.headers,
				teardownError: response.teardownError,
			};
		} else {
			// a killed process has no partial verdicts to report — the duration, the
			// reason and any workflow cases that finished first are all that exist
			status = response.timedOut ? "timeout" : "error";
			result = {
				success: false,
				result: [],
				error: response.error,
				teardownError: response.teardownError,
				...(response.cases?.length && {
					cases: response.cases,
					counts: countCases(response.cases),
				}),
			};
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

/** a suite's setup or teardown block, when it has one that still exists */
function phase(names: Map<string, string>, blockId: string | null, timeoutMs: number) {
	const block = blockId ? names.get(blockId) : undefined;
	return block ? { block, timeoutMs } : undefined;
}

/** custom block id -> name, for the setup / teardown blocks of a run */
async function loadBlockNames(ids: Array<string | null>) {
	const wanted = [...new Set(ids.filter((id): id is string => !!id))];
	if (wanted.length === 0) return new Map<string, string>();
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		.where(inArray(customBlocksListEntity.id, wanted));
	return new Map(rows.map((r) => [r.id, r.name]));
}

const INPUT_TIMEOUT_MS = 30_000;

/**
 * Where a workflow suite's input comes from (#487). A script is compiled here,
 * in the parent, into a custom block the child registers like any other; a
 * loader is a test-only custom block the child already has.
 */
function inputSpec(
	suite: Suite,
	names: Map<string, string>,
	compiled: CompiledSuiteTarget,
): { input: SuiteInputSpec; script?: { name: string; source: string } } {
	const input = suite.input ?? { source: "raw", mode: "single", raw: null };
	const timeoutMs = input.timeoutMs ?? INPUT_TIMEOUT_MS;
	if (input.source === "script") {
		return {
			input: { mode: input.mode, block: { block: INPUT_SCRIPT_BLOCK, timeoutMs } },
			script: {
				name: INPUT_SCRIPT_BLOCK,
				source: compileInputScript(input.script ?? "", compiled.dependencies),
			},
		};
	}
	if (input.source === "loader") {
		const block = input.loaderBlockId ? names.get(input.loaderBlockId) : undefined;
		if (!block) throw new Error("The input loader block is not set or was deleted");
		return { input: { mode: input.mode, block: { block, timeoutMs } } };
	}
	return { input: { mode: input.mode, raw: input.raw } };
}
