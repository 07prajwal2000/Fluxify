import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "../packages/depsDir";
import { createExecutionSupervisor, type ExecutionSupervisorOptions } from "./executionSupervisor";
import type { PluginBlockRef } from "./pluginLoader";

const root = mkdtempSync(join(tmpdir(), "fluxify-plugin-swap-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);

function version(v: string): PluginBlockRef {
	const entry = join(pluginDir("p1", "acme/echo", v, root), "say.js");
	mkdirSync(join(entry, ".."), { recursive: true });
	writeFileSync(entry, `export default { run: () => ({ output: "${v}" }) };`);
	return { projectId: "p1", type: "acme/echo/say", plugin: "acme/echo", version: v, entry, meta: {} };
}

let refs = [version("1.0.0")];
const options: ExecutionSupervisorOptions = {
	projectId: "p1",
	port,
	entry: new URL("./pluginSwapChild.fixture.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
	maxRequestBodyBytes: 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => [],
	trustedOrigins: [],
	baseDomain: () => "",
	timeoutsEnabled: () => false,
	pluginRefs: () => refs,
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

/** what the served block answers, once it answers `expected` */
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

test("a plugin upgrade replaces the child exactly once, and the new code answers", async () => {
	supervisor.start();
	expect(await answers("1.0.0")).toBe("1.0.0");
	const spawn = spyOn(Bun, "spawn");
	try {
		// a new plugin installed, nothing upgraded: the running child takes it
		refs = [...refs, { ...version("1.0.0"), type: "acme/echo/other" }];
		await supervisor.pluginRefsChanged();
		expect(spawn).not.toHaveBeenCalled();

		refs = [version("2.0.0")];
		// a second change landing mid-swap coalesces into the same child
		await Promise.all([supervisor.pluginRefsChanged(), supervisor.pluginRefsChanged()]);
		expect(await answers("2.0.0")).toBe("2.0.0");
		expect(spawn).toHaveBeenCalledTimes(1);
	} finally {
		spawn.mockRestore();
	}
}, 20_000);

test("a block that left and returns at another version still replaces the child", async () => {
	const spawn = spyOn(Bun, "spawn");
	try {
		// an approved plugin goes back to pending on a new upload, and is approved again
		refs = [];
		await supervisor.pluginRefsChanged();
		expect(spawn).not.toHaveBeenCalled();

		refs = [version("3.0.0")];
		await supervisor.pluginRefsChanged();
		expect(await answers("3.0.0")).toBe("3.0.0");
		expect(spawn).toHaveBeenCalledTimes(1);
	} finally {
		spawn.mockRestore();
	}
}, 20_000);

test("a plugin removed replaces the child, so nothing of it stays loaded", async () => {
	const spawn = spyOn(Bun, "spawn");
	try {
		refs = [];
		await supervisor.pluginRefsChanged({ removed: true });
		// Windows restarts through crash recovery, a moment later
		for (let i = 0; i < 250 && !spawn.mock.calls.length; i++) await Bun.sleep(20);
		expect(spawn).toHaveBeenCalledTimes(1);
	} finally {
		spawn.mockRestore();
	}
}, 20_000);
