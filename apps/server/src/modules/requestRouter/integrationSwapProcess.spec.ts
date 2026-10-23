import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "../packages/depsDir";
import { createExecutionSupervisor, type ExecutionSupervisorOptions } from "./executionSupervisor";
import type { PluginIntegrationRef } from "./pluginIntegrations";

// A plugin integration upgrade (I6) swaps the execution child the way a block
// upgrade does: the fresh child opens clients with the new code, and the old
// one finishes what it holds before it goes.

const root = mkdtempSync(join(tmpdir(), "fluxify-integration-swap-"));
// below 32768: Linux hands 32768–60999 to outgoing connections
const port = 20_000 + Math.floor(Math.random() * 12_000);

function version(v: string, variant = "Hub"): PluginIntegrationRef {
	const entry = join(pluginDir("p1", "acme/crm", v, root), `${variant}.js`);
	mkdirSync(join(entry, ".."), { recursive: true });
	writeFileSync(
		entry,
		`export default { name: "acme/crm/${variant.toLowerCase()}", label: "${variant}", icon: "x", group: "crm",
			variant: "${variant}", config: {}, connect: () => ({ version: "${v}" }) };`,
	);
	return { projectId: "p1", plugin: "acme/crm", version: v, group: "acme/crm", variant, icon: "data:image/svg+xml;base64,PHN2Zy8+", entry };
}

let refs = [version("1.0.0")];
const options: ExecutionSupervisorOptions = {
	projectId: "p1",
	port,
	entry: new URL("./integrationSwapChild.fixture.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 4_000 },
	maxRequestBodyBytes: 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => [],
	trustedOrigins: [],
	baseDomain: () => "",
	timeoutsEnabled: () => false,
	pluginRefs: () => [],
	pluginIntegrationRefs: () => refs,
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

/** what the served client says, once it says `expected` */
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

test("an integration upgrade replaces the child once; a new kind goes to the running one", async () => {
	supervisor.start();
	expect(await answers("1.0.0")).toBe("1.0.0");
	const spawn = spyOn(Bun, "spawn");
	try {
		refs = [...refs, version("1.0.0", "Deal")];
		await supervisor.pluginRefsChanged();
		expect(spawn).not.toHaveBeenCalled();

		refs = [version("2.0.0"), version("2.0.0", "Deal")];
		await supervisor.pluginRefsChanged();
		expect(await answers("2.0.0")).toBe("2.0.0");
		expect(spawn).toHaveBeenCalledTimes(1);
	} finally {
		spawn.mockRestore();
	}
}, 30_000);

// Linux only: Windows has no shared-port reuse, so there the swap is a restart.
test.skipIf(process.platform === "win32")(
	"a request in flight on the old version finishes on its client while the new one takes over",
	async () => {
		const inFlight = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.text());
		await Bun.sleep(200);
		refs = [version("3.0.0"), version("3.0.0", "Deal")];
		await supervisor.pluginRefsChanged();
		expect(await answers("3.0.0")).toBe("3.0.0");
		expect(await inFlight).toBe("2.0.0");
	},
	30_000,
);
