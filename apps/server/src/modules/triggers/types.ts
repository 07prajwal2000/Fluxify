import type { RetryPolicy, TriggerEvent, TriggerSource } from "@fluxify/blocks";
import { groupPair } from "@fluxify/common/orchestrator";

/**
 * What a trigger hands a workflow: the events it collected, and where they came
 * from.
 *
 * This travels as a job payload rather than on its own IPC channel — the
 * supervisor already forwards jobs to the execution process and waits for the
 * reply that drives the ack, and a second path would be a second place for that
 * ack bookkeeping to be got wrong.
 */
export type TriggerBatch = {
	/** The trigger row's id, or `internal` for the block and Run-button path. */
	triggerId: string;
	source: TriggerSource;
	events: TriggerEvent[];
};

/**
 * What the Trigger Workflow block and the Run button publish. The workflow is
 * named in the message because this path has no trigger row to take an id from.
 */
export type InternalTriggerMessage = {
	workflowId: string;
	data: unknown;
	/** Who fired it, for the event's `meta`. */
	origin?: Record<string, unknown>;
	/** The block's own retry settings; unset falls back to the worker's. */
	retry?: RetryPolicy;
	/** The block's Run ID. Never the message id: that is the broker's dedupe key. */
	runKey?: string;
};

/** A plugin trigger's row type: `plugin:` and its manifest name, e.g. `plugin:acme/pg/poller`. */
const PLUGIN_TYPE = "plugin:";
export const isPluginTriggerType = (type: string) => type.startsWith(PLUGIN_TYPE);
export const pluginTriggerType = (kind: string) => `${PLUGIN_TYPE}${kind}`;
export const pluginTriggerKind = (type: string) => type.slice(PLUGIN_TYPE.length);

/**
 * Whether a trigger is consumed by the execution process itself. External
 * queues and plugin triggers run right beside the workflow, with no copy onto
 * the internal broker; only `internal` travels over NATS. (Schedules publish no
 * artifact.)
 */
export function consumedInExecution(type: string) {
	return type !== "internal";
}

/**
 * Whether this worker runs a trigger.
 *
 * A worker pinned to groups runs only those groups' triggers; a catch-all
 * worker runs everything *except* the groups a dedicated node already owns,
 * which is what `excludedGroups` holds.
 *
 * Pinned and excluded are never both set: a node either names its groups or
 * takes what is left over.
 */
export function runsHere(
	trigger: { projectId: string; groupId: string; type?: string },
	workerGroupIds: readonly string[] | undefined,
	canRunEnterprise?: boolean,
	excludedGroups?: ReadonlySet<string>,
) {
	if (workerGroupIds?.length && !workerGroupIds.includes(trigger.groupId)) return false;
	if (excludedGroups?.has(groupPair(trigger.projectId, trigger.groupId))) return false;
	return true;
}

export function isTriggerBatch(value: unknown): value is TriggerBatch {
	const batch = value as TriggerBatch | undefined;
	return !!batch && typeof batch.triggerId === "string" && Array.isArray(batch.events);
}
