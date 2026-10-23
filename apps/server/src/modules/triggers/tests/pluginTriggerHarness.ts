// Shared by the plugin trigger runtime specs: a trigger definition becomes an
// installed module on disk (a real import through the real loader), its ref is
// handed to the runtime the way the supervisor does, and a workflow is compiled
// in, so `emit` ends a real run.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyTrigger } from "@fluxify/sdk/triggers";
import { hydrateAppConfig } from "../../../loaders/appconfigLoader";
import type { TriggerArtifact, WorkflowArtifact } from "../../compiler/artifacts";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import { type PluginTriggerRef, setPluginTriggerRefs } from "../../requestRouter/pluginTriggers";
import { pluginTriggerLimits } from "../pluginTriggerRuntime";
import { setTriggerFaultReporter, type TriggerFault } from "../queueRuntime";

export const PROJECT = "proj-plugin-triggers";
export const WORKFLOW = "wf-plugin";
export const INTEGRITY = "sha512-installed";

const root = mkdtempSync(join(tmpdir(), "fx-plugin-triggers-"));
const defs = ((globalThis as { __fxTriggerDefs?: Record<string, AnyTrigger> }).__fxTriggerDefs ??=
	{});
const entries = new WeakMap<AnyTrigger, string>();
let refs: PluginTriggerRef[] = [];
let modules = 0;

/** an installed module whose default export is `def`; one file per definition, as ESM caches by path */
function entryFor(def: AnyTrigger) {
	let entry = entries.get(def);
	if (entry) return entry;
	const n = ++modules;
	defs[n] = def;
	entry = join(root, String(n), "trigger.js");
	mkdirSync(join(entry, ".."), { recursive: true });
	writeFileSync(entry, `export default globalThis.__fxTriggerDefs[${n}];\n`);
	entries.set(def, entry);
	return entry;
}

/** what the supervisor would hand over once `def`'s plugin is installed */
export function install(
	def: AnyTrigger,
	permissions = { integrations: [] as string[], appconfig: false },
	integrity = INTEGRITY,
) {
	const ref: PluginTriggerRef = {
		projectId: PROJECT,
		plugin: def.name.split("/").slice(0, 2).join("/"),
		version: "1.0.0",
		integrity,
		kind: def.name,
		entry: entryFor(def),
		permissions,
	};
	refs = [...refs.filter((r) => r.kind !== ref.kind), ref];
	setPluginTriggerRefs(refs);
	return ref;
}

export function uninstallAll() {
	refs = [];
	setPluginTriggerRefs([]);
}

export function artifact(
	triggerId: string,
	kind: string,
	overrides: Partial<TriggerArtifact> = {},
): TriggerArtifact {
	return {
		triggerId,
		projectId: PROJECT,
		workflowId: WORKFLOW,
		groupId: "default",
		type: `plugin:${kind}`,
		integrationId: null,
		batchSize: 1,
		maxWaitMs: 0,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		source: {},
		maxAttempts: 3,
		retryDelayMs: 0,
		plugin: {
			kind,
			name: kind.split("/").slice(0, 2).join("/"),
			version: "1.0.0",
			integrity: INTEGRITY,
			retry: false,
		},
		publishedAt: new Date().toISOString(),
		...overrides,
	};
}

/** the attached workflow: its body is `source`, which sees `ctx.vars.trigger` */
export function workflow(source: string) {
	applyArtifactUpdate(`workflow.${PROJECT}.${WORKFLOW}`, {
		workflowId: WORKFLOW,
		projectId: PROJECT,
		projectName: "Plugin Triggers",
		name: "Plugin Workflow",
		timeoutSeconds: 30,
		tracingEnabled: false,
		recordExecution: false,
		workflowVersion: "2026-10-23T00:00:00.000Z",
		source,
		compiledAt: "2026-10-23T00:00:00.000Z",
	} satisfies WorkflowArtifact);
}

export const unloadWorkflow = () => applyArtifactUpdate(`workflow.${PROJECT}.${WORKFLOW}`, null);

export function appConfig(values: Record<string, string>, missing: string[] = []) {
	hydrateAppConfig(PROJECT, values, missing);
}

export const faults: TriggerFault[] = [];
setTriggerFaultReporter((fault) => faults.push(fault));

/** short enough for a test; restored by `resetLimits` */
const defaults = { ...pluginTriggerLimits };
export function fastLimits() {
	Object.assign(pluginTriggerLimits, {
		maxFailures: 3,
		retryDelayMs: 5,
		startTimeoutMs: 500,
		stopTimeoutMs: 100,
		stableMs: 60_000,
	});
}
export const resetLimits = () => Object.assign(pluginTriggerLimits, defaults);

/** polls `read` until `done` holds, or fails naming `what` */
export async function until<T>(read: () => T, done: (value: T) => boolean, what: string, ms = 3000) {
	const end = Date.now() + ms;
	for (;;) {
		const value = read();
		if (done(value)) return value;
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
		await Bun.sleep(5);
	}
}
