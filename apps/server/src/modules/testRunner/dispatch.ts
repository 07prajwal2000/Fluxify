import { RpcError, rpcRequest } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import { type TestBootstrap, type TestResult, type TestRunRequest, testRunSubject } from "./types";

/**
 * Past the route's own timeout: the worker's watchdog grace, the child's
 * start-up, and a wait for a free slot in the worker's pool.
 *
 * ponytail: a suite queued behind a busy worker pool for longer than this is
 * reported as a timeout; stream suites through JetStream if fleets outgrow it.
 */
const DISPATCH_GRACE_MS = 10_000;

/**
 * Admin's half of a test run (#478): send one suite to a worker serving the
 * project and wait for its verdict. The bootstrap carries resolved integration
 * credentials, so it crosses the bus sealed.
 */
export async function runSuiteOnWorker(bootstrap: TestBootstrap): Promise<TestResult> {
	const startedAt = Date.now();
	try {
		return await rpcRequest<TestRunRequest, TestResult>(
			natsConnection(),
			testRunSubject(bootstrap.projectId),
			{ sealed: EncryptionService.encrypt(JSON.stringify(bootstrap)) },
			{ meta: undefined, timeoutMs: bootstrap.timeoutMs + DISPATCH_GRACE_MS },
		);
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		if (error instanceof RpcError && error.code === "NO_RESPONDERS") {
			return {
				ok: false,
				error: "No worker is serving this project's routes. Start one, then run the suite again.",
				durationMs,
			};
		}
		if (error instanceof RpcError && error.code === "TIMEOUT") {
			return {
				ok: false,
				timedOut: true,
				error: `No result from a worker within ${bootstrap.timeoutMs + DISPATCH_GRACE_MS}ms`,
				durationMs,
			};
		}
		throw error;
	}
}
