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

export function isTriggerBatch(value: unknown): value is TriggerBatch {
	const batch = value as TriggerBatch | undefined;
	return !!batch && typeof batch.triggerId === "string" && Array.isArray(batch.events);
}
