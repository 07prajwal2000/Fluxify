import type { AssertionResult } from "../../db/schema";
import type { ProjectConfigPayload } from "../compiler/artifacts";
import type { AssertionType, SuiteRequest } from "./assertions";
import type { SuiteHook } from "./hooks";

/**
 * Everything the ephemeral suite process is given, in one message.
 *
 * The child starts cold: no database, no NATS, no artifact store, no
 * credentials. Anything missing here is not reachable from inside it — which is
 * the point. `config` is the payload `resolveSuiteConfig` produced, so the
 * suite's overrides are already applied and no override travels separately.
 */
export type TestBootstrap = {
	suiteRunId: string;
	projectId: string;
	route: {
		id: string;
		projectName: string;
		bodySchema?: unknown;
		querySchema?: unknown;
		paramsSchema?: unknown;
	};
	/** compiled graph source — the child never sees blocks or edges */
	source: string;
	customBlocks: Array<{ name: string; source: string }>;
	config: ProjectConfigPayload;
	request: SuiteRequest;
	/** route.timeoutSeconds * 1000 — drives both the in-band stopper and the watchdog */
	timeoutMs: number;
	/** judged in the child, right after the route answers */
	assertions: AssertionType[];
	/** the suite's block hooks (#483); `source` is compiled with hook points */
	hooks: SuiteHook[];
	suite: { id: string; name: string };
	/**
	 * Test-only custom blocks (by name, compiled into `customBlocks`) run before
	 * and after the request, each with its own time budget (#483).
	 */
	setup?: SuitePhase;
	teardown?: SuitePhase;
};

export type SuitePhase = { block: string; timeoutMs: number };

/** how the suite ended, as teardown sees it in `testsuite.outcome` */
export type SuiteOutcome = "passed" | "failed" | "error" | "timeout";

/**
 * The raw response plus the child's verdict on it. The raw parts are kept
 * because the results UI shows them beside the verdict.
 */
export type TestResult =
	| {
			ok: true;
			status: number;
			data: unknown;
			headers: Record<string, string>;
			/** the route alone, not process start-up */
			durationMs: number;
			verdict: { success: boolean; result: AssertionResult[] };
			/** the suite keeps its status; this only warns (#483) */
			teardownError?: string;
	  }
	| {
			ok: false;
			error: string;
			timedOut?: boolean;
			durationMs: number;
			teardownError?: string;
	  };

/**
 * `teardownOnly`: a fresh child that runs just the teardown, after the suite's
 * own child was killed mid-setup or mid-route — seed data must not leak.
 */
export type TestBootstrapMessage = {
	type: "bootstrap";
	bootstrap: TestBootstrap;
	teardownOnly?: { setup: unknown; outcome: SuiteOutcome };
};

/**
 * The child reports each phase as it ends, so the supervisor can time each
 * phase on its own budget and still has the route's result if teardown hangs.
 */
export type TestChildMessage =
	| { type: "ready" }
	| { type: "setup-done"; setup: unknown }
	| { type: "route-done"; result: TestResult }
	| { type: "teardown-done"; error?: string };

/**
 * Admin -> worker: run one suite (#478). Per project, so only a worker that
 * serves the project (and has its packages installed) answers.
 */
export const testRunSubject = (projectId: string) => `fluxify.tests.run.${projectId}`;
/** every worker of a project shares the suites instead of each running all of them */
export const TEST_RUN_QUEUE = "fluxify_test_runners";

/**
 * The `TestBootstrap` sealed with MASTER_ENCRYPTION_KEY, like the project-config
 * artifact: it carries resolved integration credentials across the bus. The
 * supervisor unseals it; the key never reaches the child.
 */
export type TestRunRequest = { sealed: string };
