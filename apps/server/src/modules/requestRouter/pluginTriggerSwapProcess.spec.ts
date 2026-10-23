import { afterAll, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "../packages/depsDir";
import { createExecutionSupervisor, type ExecutionSupervisorOptions } from "./executionSupervisor";
import type { PluginTriggerRef } from "./pluginTriggers";

const root = mkdtempSync(join(tmpdir(), "fluxify-trigger-swap-"));
const port = 20_000 + Math.floor(Math.random() * 12_000);
const stopped = (v: string) => join(root, `stopped-${v}`);

/** an installed version of the trigger: its instance says its version, and leaves a mark when stopped */
function version(v: string): PluginTriggerRef {
	const entry = join(pluginDir("p1", "acme/tick", v, root), "poll.js");
	mkdirSync(join(entry, ".."), { recursive: true });
	writeFileSync(
		entry,
		`import { writeFileSync } from "node:fs";
export default { name: "acme/tick/poll", start: async () => {
	globalThis.tickVersion = "${v}";
	return async () => writeFileSync(${JSON.stringify(stopped(v))}, "");
} };\n`,
	);
	return {
		projectId: "p1",
		plugin: "acme/tick",
		version: v,
		integrity: `sha512-${v}`,
		kind: "acme/tick/poll",
		entry,
		permissions: { integrations: [], appconfig: false },
	};
}

let triggers = [version("1.0.0")];
const options: ExecutionSupervisorOptions = {
	projectId: "p1",
	port,
	entry: new URL("./pluginTriggerSwapChild.fixture.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
	maxRequestBodyBytes: 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => [],
	trustedOrigins: [],
	baseDomain: () => "",
	timeoutsEnabled: () => false,
	pluginRefs: () => [],
	pluginTriggerRefs: () => triggers,
	pluginReplaceJitterMs: 0,
};
const supervisor = createExecutionSupervisor(options);

afterAll(async () => {
	supervisor.stop();
	const child = supervisor.child();
	child?.kill();
	await child?.exited;
	rmSync(root, { recursive: true, force: true });
});

async function answers(expected: string) {
	let last: string | null = null;
	for (let attempt = 0; attempt < 250; attempt++) {
		last = await fetch(`http://127.0.0.1:${port}`)
			.then((r) => r.text())
			.catch(() => null);
		if (last === expected) return last;
		await Bun.sleep(20);
	}
	return last;
}

test("a new version of a plugin trigger replaces the child once, and the new code runs", async () => {
	supervisor.start();
	expect(await answers("1.0.0")).toBe("1.0.0");
	const spawn = spyOn(Bun, "spawn");
	try {
		// the same version handed over again: the running child keeps it
		await supervisor.pluginRefsChanged();
		expect(spawn).not.toHaveBeenCalled();

		triggers = [version("2.0.0")];
		await supervisor.pluginRefsChanged();
		expect(await answers("2.0.0")).toBe("2.0.0");
		expect(spawn).toHaveBeenCalledTimes(1);
		// the old child drained with SIGTERM, which stops its instances; Windows
		// kills it outright instead (no shared port to swap on)
		if (process.platform !== "win32") expect(existsSync(stopped("1.0.0"))).toBe(true);
	} finally {
		spawn.mockRestore();
	}
}, 20_000);
