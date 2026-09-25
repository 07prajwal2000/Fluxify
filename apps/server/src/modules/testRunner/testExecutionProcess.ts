import {
	instantiateCompiled,
	invokeCustomBlock,
	registerCompiledCustomBlock,
	setJobEnqueuer,
} from "@fluxify/blocks";
import type { AssertionResult } from "../../db/schema";
import { hydrateAppConfig } from "../../loaders/appconfigLoader";
import { hydrateIntegrations } from "../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../loaders/projectSettingsLoader";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import { setBlocksExecutor } from "../requestRouter/executor";
import { createHttpContext } from "../requestRouter/httpContext";
import { createJobContext, executeRouteInternal } from "../requestRouter/service";
import { evaluateAssertions } from "./assertions";
import { buildHooks } from "./hookRuntime";
import { contentTypeOf, decodeSuiteBody } from "./suiteBody";
import type {
	SuiteOutcome,
	TestBootstrap,
	TestBootstrapMessage,
	TestChildMessage,
	TestResult,
} from "./types";

/**
 * Ephemeral child that runs exactly one test suite and exits.
 *
 * Never reused. A second suite in the same process would inherit module state,
 * open database clients and timers from the first — the precise thing that makes
 * a test pass for the wrong reason.
 *
 * It holds no system credentials: no master encryption key, no NATS, no admin
 * database url. The route's own integration connection details do arrive in the
 * bootstrap, because the route cannot run without them.
 *
 * Order (#483): setup → route + hooks + assertions → teardown, each phase
 * reported to the supervisor as it ends so it can time each on its own budget.
 */
process.env = executionRuntimeEnvironment();
process.argv = [];
process.execArgv = [];

process.on("message", (message: TestBootstrapMessage) => {
	if (message?.type !== "bootstrap") return;
	void (message.teardownOnly
		? runTeardownOnly(message.bootstrap, message.teardownOnly)
		: runSuite(message.bootstrap));
});

/** What the suite would have queued, kept for debugging a run. */
const queuedJobs: string[] = [];
/** `t.expect` lines from block hooks, reported beside the assertions */
const hookChecks: AssertionResult[] = [];

const send = (message: TestChildMessage) => process.send?.(message);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The caches are the runtime's only config source — nothing here queries — and
 * the suite's overrides are already baked in. Custom blocks go in first: the
 * route, setup and teardown all run from that library.
 */
function prepare(boot: TestBootstrap) {
	hydrateAppConfig(boot.projectId, boot.config.appConfig);
	hydrateIntegrations(boot.projectId, {
		db: boot.config.dbIntegrations,
		kv: boot.config.kvIntegrations,
		observability: boot.config.observabilityIntegrations,
		ai: boot.config.aiIntegrations,
	});
	hydrateProjectSettings(boot.projectId, boot.config.projectSettings);
	for (const block of boot.customBlocks) {
		registerCompiledCustomBlock(block.name, block.source);
	}
	// A test run holds no broker connection, and firing real background work
	// from an assertion is not something a suite should be able to do.
	setJobEnqueuer((job) => queuedJobs.push(`${job.kind}/${job.target}`));
}

/**
 * Runs the setup or teardown custom block. It reads `testsuite` as a bare
 * global: block code falls back to globalThis for names it does not hold, and
 * this process runs one suite only.
 */
async function runPhase(
	boot: TestBootstrap,
	phase: "setup" | "teardown",
	extra: { setup?: unknown; outcome?: SuiteOutcome } = {},
) {
	const { block, timeoutMs } = boot[phase]!;
	(globalThis as { testsuite?: unknown }).testsuite = {
		phase,
		runId: boot.suiteRunId,
		suite: boot.suite,
		...extra,
	};
	const context = createJobContext({
		id: boot.suiteRunId,
		projectId: boot.projectId,
		target: block,
		timeoutSeconds: timeoutMs / 1000,
	});
	try {
		return await invokeCustomBlock(context, block, { params: {} });
	} finally {
		context.dbFactory?.dispose();
	}
}

async function runSuite(boot: TestBootstrap) {
	let setup: unknown;
	let result: TestResult | undefined;
	try {
		prepare(boot);
	} catch (error) {
		result = { ok: false, error: messageOf(error), durationMs: 0 };
	}

	if (!result && boot.setup) {
		const startedAt = Date.now();
		try {
			setup = await runPhase(boot, "setup");
			send({ type: "setup-done", setup });
		} catch (error) {
			// the route is skipped, but teardown still runs: setup may have seeded half
			result = {
				ok: false,
				error: `Setup failed: ${messageOf(error)}`,
				durationMs: Date.now() - startedAt,
			};
		}
	}

	result ??= await runRoute(boot, setup);
	send({ type: "route-done", result });
	await finish(boot, () => runPhase(boot, "teardown", { setup, outcome: outcomeOf(result) }));
}

/** a fresh child's only job, after the suite's own child was killed */
async function runTeardownOnly(
	boot: TestBootstrap,
	{ setup, outcome }: { setup: unknown; outcome: SuiteOutcome },
) {
	await finish(boot, async () => {
		prepare(boot);
		await runPhase(boot, "teardown", { setup, outcome });
	});
}

async function finish(boot: TestBootstrap, teardown: () => Promise<unknown>) {
	let error: string | undefined;
	if (boot.teardown) {
		try {
			await teardown();
		} catch (e) {
			error = messageOf(e);
		}
	}
	send({ type: "teardown-done", error });
	// let the ipc write flush before tearing the process down; the parent kills
	// the child regardless, so this is only about exiting cleanly
	setTimeout(() => process.exit(0), 0);
}

function outcomeOf(result: TestResult): SuiteOutcome {
	if (!result.ok) return result.timedOut ? "timeout" : "error";
	return result.verdict.success ? "passed" : "failed";
}

async function runRoute(boot: TestBootstrap, setup: unknown): Promise<TestResult> {
	const startedAt = Date.now();
	try {
		const run = instantiateCompiled(boot.source);
		setBlocksExecutor((_target, context) => {
			// hooks read and write this request's vars, so they bind per context
			(context as { testHooks?: unknown }).testHooks = buildHooks(boot.hooks, {
				vars: context.vars,
				runId: boot.suiteRunId,
				setup,
				checks: hookChecks,
			});
			return run(context, context.requestBody);
		});

		// a real Hono-shaped context, so header and cookie writes made by the route
		// are captured instead of dropped — header assertions read them back
		const ctx = createHttpContext(
			new Request(`http://test.local${boot.request.path}`, {
				method: boot.request.method,
				headers: boot.request.headers,
			}),
		);

		const routeStartedAt = Date.now();
		const response = await executeRouteInternal(
			{
				id: boot.route.id,
				projectId: boot.projectId,
				projectName: boot.route.projectName,
				bodySchema: boot.route.bodySchema,
				querySchema: boot.route.querySchema,
				paramsSchema: boot.route.paramsSchema,
				// the engine's in-band stall budget, from the same number the
				// watchdog uses, so neither can silently outlive the other
				timeoutSeconds: boot.timeoutMs / 1000,
			},
			{
				...boot.request,
				body: decodeSuiteBody(boot.request.body, contentTypeOf(boot.request.headers)),
			},
			ctx as any,
		);

		const durationMs = Date.now() - routeStartedAt;
		const headers = Object.fromEntries(ctx.responseHeaders);
		const verdict = await evaluateAssertions(boot.assertions, {
			status: response.status,
			body: response.data,
			headers,
			durationMs,
			request: boot.request,
			setup,
		});
		return {
			ok: true,
			status: response.status,
			data: response.data,
			headers,
			durationMs,
			// hook checks first: they ran first, inside the route
			verdict: {
				success: verdict.success && hookChecks.every((c) => c.success),
				result: [...hookChecks, ...verdict.result],
			},
		};
	} catch (error) {
		return { ok: false, error: messageOf(error), durationMs: Date.now() - startedAt };
	}
}

send({ type: "ready" });
