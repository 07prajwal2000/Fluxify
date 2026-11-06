import { LAG_PER_WORKER, lagPerWorkerParam, type TriggerEntry } from "@fluxify/sdk/triggers";
import type { DbTransactionType } from "../../../db";
import { findTriggerKind } from "../../../modules/plugins/triggerKinds";
import { lagTargetOf } from "../../../modules/triggers/lagShared";
import { isPluginTriggerType, pluginTriggerKind } from "../../../modules/triggers/types";

/**
 * The `lagPerWorker` setting of a plugin trigger whose kind defines `lag` (#963):
 * how much backlog one worker clears, which the orchestrator turns into the
 * number of workers KEDA runs. It lives in the row's `source`, beside the
 * author's params, and is checked as a number param so the form, the review and
 * these checks all agree on it.
 */

const unset = (value: unknown) => value === undefined || value === null || value === "";

/**
 * The source as it will be saved, `lagPerWorker` settled: the user's value, else
 * the kind's default. Without either it stays empty, and `lagParam` makes that an
 * error where the setting is required. Untouched for a kind with no `lag`.
 */
export function settleLag(entry: TriggerEntry, source: Record<string, unknown> = {}) {
	if (!entry.lag || !unset(source[LAG_PER_WORKER]) || entry.lag.default === undefined)
		return source;
	return { ...source, [LAG_PER_WORKER]: entry.lag.default };
}

/**
 * The param to check `lagPerWorker` against, or none. A trigger saved before its
 * plugin gained `lag` has no value and keeps scaling on cpu and memory, so an edit
 * is never refused for lacking one; a new trigger, one that already had a value,
 * and any value that is set are all checked.
 */
export function lagParam(
	entry: TriggerEntry,
	source: Record<string, unknown>,
	state: { creating?: boolean; hadLag?: boolean },
) {
	if (!entry.lag) return {};
	const wanted = state.creating || state.hadLag || !unset(source[LAG_PER_WORKER]);
	return wanted ? { [LAG_PER_WORKER]: lagPerWorkerParam(entry.lag) } : {};
}

/** `source` with `lagPerWorker` settled for the kind a row's type names; the source itself when the kind has no `lag` */
export async function settleLagOf(
	check: { type: string; projectId: string; source?: unknown },
	tx?: DbTransactionType,
) {
	const source = (check.source ?? undefined) as Record<string, unknown> | undefined;
	if (!isPluginTriggerType(check.type)) return source;
	const found = await findTriggerKind(check.projectId, pluginTriggerKind(check.type), tx);
	return found ? settleLag(found.entry, source) : source;
}

/**
 * What an edit does about `lagPerWorker`. `check` is what it is saved against: the
 * source it ends up with (settled when it sends one, else the row's own), and
 * whether the row already held a value, which it may not clear. `patch` is the
 * source to write, only when the edit sent one.
 */
export async function lagOnUpdate(
	existing: { type: string; projectId: string; source: unknown },
	sent: Record<string, unknown> | null | undefined,
	tx?: DbTransactionType,
) {
	const source = sent ? await settleLagOf({ ...existing, source: sent }, tx) : existing.source;
	return {
		check: { source, hadLag: lagTargetOf(existing.source) !== undefined },
		patch: sent ? { source } : {},
	};
}
