// T1's trigger contract against the worker's runtime: the definition is
// imported from disk, started from an artifact, and each `emit` runs a real
// workflow, which ends the way the suite settles it. The same suite runs
// against `@fluxify/sdk/testing` in packages/sdk, so the two cannot drift.
import { afterAll, afterEach, beforeAll } from "bun:test";
import { type CaughtEmit, triggerConformance } from "@fluxify/sdk/conformance";
import {
	applyPluginTrigger,
	pluginTriggerLimits,
	pluginTriggerStatus,
	shutdownPluginTriggers,
} from "../pluginTriggerRuntime";
import { artifact, install, resetLimits, uninstallAll, until, workflow } from "./pluginTriggerHarness";

const caught: CaughtEmit[] = [];
const waiting: ((emit: CaughtEmit) => void)[] = [];
/** the workflow's body hands its run to the suite and ends as the suite settles it */
(globalThis as { confGate?: unknown }).confGate = (trigger: any) =>
	new Promise((resolve, reject) => {
		const emit: CaughtEmit = {
			events: trigger.data.map((event: { data: unknown }) => event.data),
			connection: trigger.connection,
			resolve: () => resolve({ successful: true }),
			reject,
		};
		const next = waiting.shift();
		if (next) next(emit);
		else caught.push(emit);
	});

let n = 0;
beforeAll(() => {
	workflow("return await globalThis.confGate(ctx.vars.trigger);");
	// a failed instance stays down for the rest of a case
	pluginTriggerLimits.retryDelayMs = 60_000;
});
afterEach(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
	caught.length = 0;
});
afterAll(resetLimits);

triggerConformance("runtime", {
	async start(def, params = {}) {
		const id = `conf-${++n}`;
		install(def);
		await applyPluginTrigger(id, artifact(id, def.name, { source: params }));
		const status = await until(
			() => pluginTriggerStatus(id),
			(s) => !!s?.running || !!s?.lastFailure,
			`${id} to start`,
		);
		if (!status?.running) throw new Error(status?.lastFailure);
		return {
			nextEmit: () =>
				caught.length
					? Promise.resolve(caught.shift()!)
					: new Promise<CaughtEmit>((r) => waiting.push(r)),
			stop: () => applyPluginTrigger(id, null),
			failed: () => until(() => pluginTriggerStatus(id)?.lastFailure, Boolean, "a failure") as Promise<string>,
		};
	},
});
