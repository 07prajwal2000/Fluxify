import type { TriggerValidateContext } from "@fluxify/sdk/triggers";
import type { TriggerArtifact } from "../compiler/artifacts";
import { pluginTriggerRef } from "../requestRouter/pluginTriggers";
import { openContext } from "./pluginTriggerContext";
import { importTrigger } from "./pluginTriggerRuntime";

/** how long a trigger's `validate` may take; the admin waits a little longer */
export const TRIGGER_VALIDATE_TIMEOUT_MS = 10_000;

/**
 * A plugin trigger's `validate`, run in the execution process (the only place
 * plugin code runs) against settings that are about to be saved. Resolves to
 * its warnings; rejects with the author's error, which refuses the save.
 */
export async function validatePluginTrigger(
	projectId: string,
	kind: string,
	source: Record<string, unknown>,
	timeoutMs = TRIGGER_VALIDATE_TIMEOUT_MS,
): Promise<string[]> {
	const ref = pluginTriggerRef(projectId, kind);
	if (!ref) throw new Error(`No installed plugin here provides trigger ${kind}`);
	const def = await importTrigger(ref);
	if (!def.validate) return [];
	// a draft: the row may not exist yet, and nothing here can emit
	const draft = {
		triggerId: `validate-${crypto.randomUUID()}`,
		projectId,
		workflowId: "",
		type: `plugin:${kind}`,
		source,
	} as TriggerArtifact;
	const controller = new AbortController();
	const none = () => {};
	const { ctx, release } = openContext(draft, ref, def, {
		signal: controller.signal,
		fail: none,
		denied: none,
		reportTick: none,
		stopped: () => controller.signal.aborted,
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(`validate() did not finish within ${timeoutMs / 1000}s`));
		}, timeoutMs);
	});
	try {
		const { params, integrations, getConfig, logger, signal } = ctx;
		const checked: TriggerValidateContext = { params, integrations, getConfig, logger, signal };
		const result = await Promise.race([def.validate(checked), timeout]);
		if (result === undefined) return [];
		if (!Array.isArray(result) || !result.every((w) => typeof w === "string"))
			throw new Error("validate() must resolve to nothing or an array of strings");
		return result;
	} finally {
		clearTimeout(timer);
		controller.abort();
		release();
	}
}
