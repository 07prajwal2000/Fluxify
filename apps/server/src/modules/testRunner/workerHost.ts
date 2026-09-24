import { RpcError, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import { testWorkerPool } from "./pool";
import { runSuiteInChild } from "./spawn";
import {
	TEST_RUN_QUEUE,
	type TestBootstrap,
	type TestResult,
	type TestRunRequest,
	testRunSubject,
} from "./types";

/**
 * The worker half of a test run (#478): answers one project's suites, each in a
 * fresh child (`entry`), never in the live execution process — a suite's
 * overrides and draft code must not reach real traffic.
 *
 * The child gets the same environment as the execution process, so it resolves
 * the project's installed npm packages exactly as live routes do.
 */
export function serveTestRuns(projectId: string, entry: string): RpcResponder {
	return rpcRespond<TestRunRequest, TestResult>(
		natsConnection(),
		testRunSubject(projectId),
		async ({ sealed }) => {
			const bootstrap: TestBootstrap = JSON.parse(EncryptionService.decrypt(sealed));
			// the subject already scopes it; a mismatch means a bug, not a request to honour
			if (bootstrap.projectId !== projectId) {
				throw new RpcError("FORBIDDEN", "Suite belongs to another project");
			}
			return testWorkerPool.run(() => runSuiteInChild(bootstrap, entry));
		},
		{ queue: TEST_RUN_QUEUE },
	);
}
