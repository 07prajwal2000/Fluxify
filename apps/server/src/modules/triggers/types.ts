import type { TriggerEvent, TriggerSource } from "@fluxify/blocks";

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
};

/**
 * Whether a trigger is consumed by the execution process itself. External
 * queues are read right beside the workflow, with no copy onto the internal
 * broker; only `internal` travels over NATS. (Schedules publish no artifact.)
 */
export function consumedInExecution(type: string) {
	return type !== "internal";
}

/**
 * External connectors, which need an enterprise license. Creating one is
 * refused without it; running one stops once the license is past its grace.
 */
const ENTERPRISE_TRIGGER_TYPES: readonly string[] = ["kafka"];

export function isEnterpriseTriggerType(type: string) {
	return ENTERPRISE_TRIGGER_TYPES.includes(type);
}

/**
 * Whether this worker runs a trigger. A worker pinned to a group runs only that
 * group's triggers; a connector whose license can no longer run is not started.
 */
export function runsHere(
	trigger: { groupId: string; type: string },
	workerGroupId: string | undefined,
	canRunEnterprise: boolean,
) {
	if (workerGroupId && trigger.groupId !== workerGroupId) return false;
	return canRunEnterprise || !isEnterpriseTriggerType(trigger.type);
}

export function isTriggerBatch(value: unknown): value is TriggerBatch {
	const batch = value as TriggerBatch | undefined;
	return !!batch && typeof batch.triggerId === "string" && Array.isArray(batch.events);
}
