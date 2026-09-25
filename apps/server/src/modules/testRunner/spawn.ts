import { fileURLToPath } from "node:url";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import type { TestBootstrap, TestBootstrapMessage, TestChildMessage, TestResult } from "./types";

/** fileURLToPath, not .pathname — the latter yields "/D:/..." on Windows */
const ENTRY = fileURLToPath(new URL("./testExecutionProcess.ts", import.meta.url));

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
 * The route is user-authored code, so the descriptor cap is applied by the shell
 * that becomes the process rather than trusted to it. `ulimit` is POSIX-only, so
 * Windows spawns bun directly — dev has to work there too, it just runs without
 * the cap.
 *
 * There is deliberately no `ulimit -v`. It caps *address space*, which JSC uses
 * as a reservation, not as memory: a plain `bun` process peaks at ~129 GB of
 * virtual address space. Any value low enough to be a real cap aborts the
 * runtime with SIGABRT before user code runs (`MemoryExhaustion` — every child
 * died this way), and any value above the reservation caps nothing.
 * `BUN_JSC_forceRAMSize` is only a GC heuristic and does not bound the heap
 * either. The memory ceiling is the worker container's memory limit, which is a
 * real cgroup limit.
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
	return ["/bin/sh", "-c", `ulimit -n ${fds}; exec "$0" --smol "$1"`, process.execPath, entry];
}

type Phase = "setup" | "route" | "teardown";

/** what one child got through before it finished, died or was killed */
type ChildRun = {
	setup?: unknown;
	route?: TestResult;
	teardownError?: string;
	/** the phase the watchdog killed it in */
	killedIn?: Phase;
	/** exited without reporting the phase it was in */
	crash?: string;
};

/**
 * Runs one suite in a fresh process and resolves with its result (#483: with
 * setup and teardown around the route).
 *
 * Each phase has its own budget: setup and teardown their configured timeouts,
 * the route its timeout plus a grace. The child reports each phase as it ends,
 * which is what moves the watchdog on — and what leaves the route's result
 * here if teardown then hangs.
 *
 * A child killed (or crashed) in setup or the route never ran its teardown, so a
 * fresh child runs just the teardown: a timeout must not leave seed data behind.
 * A teardown failure never changes the suite's result, it only rides along.
 */
export async function runSuiteInChild(
	bootstrap: TestBootstrap,
	entry = ENTRY,
): Promise<TestResult> {
	const startedAt = Date.now();
	const run = await runChild(bootstrap, entry);
	if (run.route) {
		return { ...run.route, teardownError: teardownFailure(bootstrap, run) };
	}

	// the child never got through the route
	const durationMs = Date.now() - startedAt;
	const result: TestResult =
		run.killedIn === "setup"
			? {
					ok: false,
					timedOut: true,
					error: `setup timed out after ${bootstrap.setup!.timeoutMs}ms`,
					durationMs,
				}
			: run.killedIn === "route"
				? {
						ok: false,
						timedOut: true,
						error: `suite timed out after ${bootstrap.timeoutMs}ms`,
						durationMs,
					}
				: { ok: false, error: `test process ${run.crash}`, durationMs };
	if (!bootstrap.teardown) return result;

	const teardown = await runChild(bootstrap, entry, {
		setup: run.setup,
		outcome: result.timedOut ? "timeout" : "error",
	});
	return { ...result, teardownError: teardownFailure(bootstrap, teardown) };
}

function teardownFailure(bootstrap: TestBootstrap, run: ChildRun) {
	if (!bootstrap.teardown) return undefined;
	if (run.killedIn === "teardown") {
		return `teardown timed out after ${bootstrap.teardown.timeoutMs}ms`;
	}
	return run.crash ? `teardown ${run.crash}` : run.teardownError;
}

function runChild(
	bootstrap: TestBootstrap,
	entry: string,
	teardownOnly?: TestBootstrapMessage["teardownOnly"],
): Promise<ChildRun> {
	const { promise, resolve } = Promise.withResolvers<ChildRun>();
	const run: ChildRun = {};
	let settled = false;
	const finish = () => {
		if (settled) return;
		settled = true;
		clearTimeout(watchdog);
		child.kill();
		resolve(run);
	};

	const budget: Record<Phase, number> = {
		setup: bootstrap.setup?.timeoutMs ?? 0,
		route: bootstrap.timeoutMs + WATCHDOG_GRACE_MS,
		// no teardown: only the time to report that there was none
		teardown: (bootstrap.teardown?.timeoutMs ?? 0) + WATCHDOG_GRACE_MS,
	};
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	const enter = (phase: Phase) => {
		clearTimeout(watchdog);
		watchdog = setTimeout(() => {
			run.killedIn = phase;
			finish();
		}, budget[phase]);
	};
	enter(teardownOnly ? "teardown" : bootstrap.setup ? "setup" : "route");

	const child = Bun.spawn(spawnCommand(entry), {
		env: executionRuntimeEnvironment(),
		stdout: "inherit",
		stderr: "inherit",
		ipc(message: TestChildMessage) {
			switch (message?.type) {
				case "ready":
					child.send({
						type: "bootstrap",
						bootstrap,
						teardownOnly,
					} satisfies TestBootstrapMessage);
					break;
				case "setup-done":
					run.setup = message.setup;
					enter("route");
					break;
				case "route-done":
					run.route = message.result;
					enter("teardown");
					break;
				case "teardown-done":
					run.teardownError = message.error;
					finish();
					break;
			}
		},
		onExit(_child, code, signal) {
			// a crash, an OOM kill, or a hit rlimit. After a settle this is only the
			// kill (or the clean exit) finish() itself caused — nothing to record.
			if (settled) return;
			run.crash = `exited before reporting (code=${code}, signal=${signal})`;
			finish();
		},
	});

	return promise;
}
