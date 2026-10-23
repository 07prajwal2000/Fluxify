// A stand-in execution process with the process guard on: plugin triggers whose
// own code leaves errors floating, errors nobody can trace, and a workflow
// whose block throws. It reports what the runtime made of each, then exits.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPluginTriggerRefs } from "../../requestRouter/pluginTriggers";
import { applyPluginTrigger, pluginTriggerStatus } from "../pluginTriggerRuntime";
import { guardProcess } from "../strayErrors";
import { artifact, fastLimits, INTEGRITY, PROJECT, workflow } from "./pluginTriggerHarness";

guardProcess();
fastLimits();

const root = mkdtempSync(join(tmpdir(), "fx-stray-"));
/** a trigger module on disk; its code counts its starts and misbehaves on the first */
const MODULES: Record<string, string> = {
	"acme/s/loop": `(async () => { await Bun.sleep(5); throw new Error("the loop broke"); })();`,
	"acme/s/timer": `setTimeout(() => { throw new Error("the timer threw"); }, 5);`,
	"acme/s/emit": `ctx.emit([1]).then(() => (globalThis.blockError = "resolved"), (e) => (globalThis.blockError = e.message));`,
};
const g = globalThis as { starts?: Record<string, number>; blockError?: string };
g.starts = {};
setPluginTriggerRefs(
	Object.entries(MODULES).map(([kind, misbehave], i) => {
		const entry = join(root, `t${i}.js`);
		writeFileSync(
			entry,
			`export default { name: "${kind}", start: async (ctx) => {
	const n = (globalThis.starts["${kind}"] = (globalThis.starts["${kind}"] ?? 0) + 1);
	if (n === 1) { ${misbehave} }
	return async () => {};
} };\n`,
		);
		return {
			projectId: PROJECT,
			plugin: "acme/s",
			version: "1.0.0",
			integrity: INTEGRITY,
			kind,
			entry,
			permissions: { integrations: [], appconfig: false },
		};
	}),
);
workflow("throw new Error('the block broke');");

// nobody's: thrown outside any trigger
setTimeout(() => void Promise.reject(new Error("nobody's rejection")), 5);
setTimeout(() => {
	throw new Error("nobody's exception");
}, 5);
for (const kind of Object.keys(MODULES)) await applyPluginTrigger(kind, artifact(kind, kind));
await Bun.sleep(300);

// on stdout, not IPC: a message sent right before exit can be lost
console.log(`REPORT ${JSON.stringify({
	starts: g.starts,
	loop: pluginTriggerStatus("acme/s/loop"),
	timer: pluginTriggerStatus("acme/s/timer"),
	emit: pluginTriggerStatus("acme/s/emit"),
	blockError: g.blockError,
})}`);
process.exit(0);
