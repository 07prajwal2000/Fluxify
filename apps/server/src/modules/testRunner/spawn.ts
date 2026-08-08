import { fileURLToPath } from "node:url";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import type { TestBootstrap, TestChildMessage, TestResult } from "./types";

/** fileURLToPath, not .pathname — the latter yields "/D:/..." on Windows */
const ENTRY = fileURLToPath(
	new URL("./testExecutionProcess.ts", import.meta.url),
);

/** how long past the route's own timeout the child gets to report before it is killed */
const WATCHDOG_GRACE_MS = 2_000;

/** an env override is only usable as an rlimit if it is a positive integer */
function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The argv that starts one suite child.
 *
 * The route is user-authored code, so the descriptor and address-space caps are
 * applied by the shell that becomes the process rather than trusted to it.
 * `ulimit` is POSIX-only, so Windows spawns bun directly — dev has to work there
 * too, it just runs without the caps.
 *
 * The interpreter and entry path are passed as shell *arguments* ("$0"/"$1"),
 * never interpolated into the script: a path with a space or a quote would
 * otherwise change what the shell runs.
 */
export function spawnCommand(
	entry: string,
	platform: string = process.platform,
	env: NodeJS.ProcessEnv = process.env,
) {
	if (platform === "win32") return [process.execPath, "--smol", entry];
	const fds = positiveInt(env.TEST_RUNNER_MAX_FDS, 256);
	const vmemKb = positiveInt(env.TEST_RUNNER_MAX_VMEM_KB, 1_048_576);
	return [
		"/bin/sh",
		"-c",
		`ulimit -n ${fds}; ulimit -v ${vmemKb}; exec "$0" --smol "$1"`,
		process.execPath,
		entry,
	];
}

/**
 * Runs one suite in a fresh process and resolves with its raw response.
 *
 * The timeout is unconditional — `experimental.workerTimeouts` governs live
 * traffic, not tests. A killed child reports `timedOut` with a duration and
 * nothing else: partial results are not streamed out of a process that is about
 * to die, they would describe a run that never finished.
 */
export async function runSuiteInChild(
	bootstrap: TestBootstrap,
	entry = ENTRY,
): Promise<TestResult> {
	const { promise, resolve } = Promise.withResolvers<TestResult>();
	const startedAt = Date.now();
	let settled = false;
	const finish = (result: TestResult) => {
		if (settled) return;
		settled = true;
		resolve(result);
	};

	const child = Bun.spawn(spawnCommand(entry), {
		env: executionRuntimeEnvironment(),
		stdout: "inherit",
		stderr: "inherit",
		ipc(message: TestChildMessage) {
			if (message?.type === "ready") {
				child.send({ type: "bootstrap", bootstrap });
			} else if (message?.type === "result") {
				finish(message.result);
			}
		},
		onExit(_child, code, signal) {
			// a crash, an OOM kill, or a hit rlimit — the happy path already settled
			finish({
				ok: false,
				error: `test process exited before reporting (code=${code}, signal=${signal})`,
				durationMs: Date.now() - startedAt,
			});
		},
	});

	const watchdog = setTimeout(() => {
		finish({
			ok: false,
			timedOut: true,
			error: `suite timed out after ${bootstrap.timeoutMs}ms`,
			durationMs: Date.now() - startedAt,
		});
		child.kill();
	}, bootstrap.timeoutMs + WATCHDOG_GRACE_MS);

	try {
		return await promise;
	} finally {
		// an uncleared timer keeps the admin process alive for the whole timeout
		clearTimeout(watchdog);
		child.kill();
	}
}
