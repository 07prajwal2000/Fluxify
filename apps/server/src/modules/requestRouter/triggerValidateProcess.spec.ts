import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionSupervisor } from "./executionSupervisor";
import type { PluginTriggerRef } from "./pluginTriggers";

// The real execution process, spawned by the real supervisor: a `validate-trigger`
// message crosses IPC, the child imports the installed module and answers (#985).
const root = mkdtempSync(join(tmpdir(), "fluxify-trigger-validate-"));
const port = 20_000 + Math.floor(Math.random() * 12_000);
const entry = join(root, "poll.js");
mkdirSync(root, { recursive: true });
writeFileSync(
	entry,
	`export default { name: "acme/check/poll", start: async () => async () => {},
	validate: async (ctx) => {
		if (ctx.params.every > 60) throw new Error("every must be at most 60 seconds");
		return ["every " + ctx.params.every];
	} };\n`,
);
const ref: PluginTriggerRef = {
	projectId: "p1",
	plugin: "acme/check",
	version: "1.0.0",
	integrity: "sha512-1",
	kind: "acme/check/poll",
	entry,
	permissions: { integrations: [], appconfig: false },
	secretParams: [],
};

const supervisor = createExecutionSupervisor({
	projectId: "p1",
	port,
	entry: new URL("./executionProcess.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
	maxRequestBodyBytes: 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => [],
	trustedOrigins: [],
	baseDomain: () => "",
	timeoutsEnabled: () => false,
	env: "development",
	pluginTriggerRefs: () => [ref],
});

beforeAll(async () => {
	supervisor.start();
	// the child serves only once bootstrapped, so a port that answers means refs are set
	for (let i = 0; i < 500; i++) {
		if (await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false)) return;
		await Bun.sleep(20);
	}
	throw new Error("execution process never became ready");
}, 15_000);

afterAll(async () => {
	supervisor.stop();
	const child = supervisor.child();
	child?.kill();
	await child?.exited;
	rmSync(root, { recursive: true, force: true });
});

test("the child runs the trigger's validate and answers with its warnings or its error", async () => {
	const call = (source: Record<string, unknown>) =>
		supervisor.validateTrigger({ projectId: "p1", kind: "acme/check/poll", source });
	// awaited by hand: `expect(...).rejects` waits without servicing the IPC pipe, so the answer never lands
	const message = (p: Promise<unknown>) => p.then(String, (e: Error) => e.message);
	expect(await call({ every: 5 })).toEqual(["every 5"]);
	expect(await message(call({ every: 61 }))).toBe("every must be at most 60 seconds");
	expect(
		await message(
			supervisor.validateTrigger({ projectId: "p1", kind: "acme/check/gone", source: {} }),
		),
	).toBe("No installed plugin here provides trigger acme/check/gone");
}, 15_000);
