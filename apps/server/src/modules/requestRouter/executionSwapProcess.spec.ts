import { afterEach, expect, test } from "bun:test";
import { createExecutionSupervisor, type ExecutionSupervisorOptions } from "./executionSupervisor";

const port = 20_000 + Math.floor(Math.random() * 20_000);
const options: ExecutionSupervisorOptions = {
	projectId: "p1",
	port,
	entry: new URL("./executionSwapChild.fixture.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
	maxRequestBodyBytes: 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => [],
	trustedOrigins: [],
	baseDomain: () => "",
	timeoutsEnabled: () => false,
};

let supervisor: ReturnType<typeof createExecutionSupervisor> | undefined;

afterEach(async () => {
	supervisor?.stop();
	const child = supervisor?.child();
	child?.kill();
	await child?.exited;
	options.projectId = "p1";
});

async function served() {
	for (let attempt = 0; attempt < 100; attempt++) {
		const pid = await fetch(`http://127.0.0.1:${port}`)
			.then((r) => r.text())
			.catch(() => null);
		if (pid) return pid;
		await Bun.sleep(20);
	}
	throw new Error("nothing served");
}

// Linux only: Windows has no shared-port reuse, so there the swap is a restart.
test.skipIf(process.platform === "win32")(
	"swaps in a fresh child and retires the old one without dropping requests",
	async () => {
		supervisor = createExecutionSupervisor(options);
		supervisor.start();
		const before = await served();
		const old = supervisor.child();

		let failures = 0;
		let loading = true;
		const load = (async () => {
			while (loading) await fetch(`http://127.0.0.1:${port}`).catch(() => failures++);
		})();
		await supervisor.replace();
		await old?.exited;
		loading = false;
		await load;

		expect(await served()).not.toBe(before);
		expect(failures).toBe(0);
	},
	20_000,
);

test.skipIf(process.platform === "win32")(
	"keeps the old child when the new one dies before it is ready",
	async () => {
		supervisor = createExecutionSupervisor(options);
		supervisor.start();
		const before = await served();

		options.projectId = "crash";
		await supervisor.replace();

		expect(await served()).toBe(before);
		expect(String(supervisor.child()?.pid)).toBe(before);
	},
	20_000,
);

test.skipIf(process.platform !== "win32")("restarts the child on Windows", async () => {
	supervisor = createExecutionSupervisor(options);
	supervisor.start();
	const before = await served();
	await supervisor.replace();
	expect(await served()).not.toBe(before);
}, 20_000);
