import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ExecutionWatchdog } from "./executionWatchdog";

const fixture = fileURLToPath(
	new URL("./executionWatchdogChild.fixture.ts", import.meta.url),
);

async function run(mode: "async" | "spin") {
	// Allow for normal IPC scheduling jitter while the full suite is busy.
	const watchdog = new ExecutionWatchdog(() => performance.now(), 100);
	watchdog.setEnabled(true);
	let killed = false;
	const child = Bun.spawn([process.execPath, fixture, mode], {
		env: {},
		ipc: (event: any) => {
			if (event.type === "heartbeat") watchdog.heartbeat();
			if (event.type === "execution-started") watchdog.start(event);
			if (event.type === "execution-finished") watchdog.finish(event.requestId);
		},
		stdout: "ignore",
		stderr: "inherit",
	});

	while (child.exitCode === null) {
		if (watchdog.findTimedOut()) {
			killed = true;
			child.kill();
			break;
		}
		await Bun.sleep(5);
	}
	await child.exited;
	return killed;
}

test("keeps an async child alive while IPC heartbeats continue", async () => {
	expect(await run("async")).toBe(false);
});

test("kills a CPU-blocked child when its IPC heartbeat stops", async () => {
	expect(await run("spin")).toBe(true);
});
