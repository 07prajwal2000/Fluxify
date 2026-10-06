import { logger } from "@fluxify/common";
import { ensureStreamOnce, publishToStream } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { internalSubject, TRIGGERS_STREAM_SPEC, triggerSubject } from "./subjects";
import type { InternalTriggerMessage } from "./types";

/**
 * Publishing onto the triggers stream.
 *
 * Throws rather than logging: the caller asked for durable work, and a queue
 * that swallows failures is worse than one that refuses them.
 *
 * Creates the stream first: the admin can publish before any worker has (the
 * kit's first boot has no worker at all), and the event then waits for one.
 */
async function publish(subject: string, data: unknown, opts: { msgId?: string } = {}) {
	const nc = natsConnection();
	await ensureStreamOnce(nc, TRIGGERS_STREAM_SPEC);
	await publishToStream(nc, subject, data, opts);
}

export type InternalTriggerInput = InternalTriggerMessage & {
	projectId: string;
	/** Supply one to make a retry of the same logical fire collapse into one run. */
	id?: string;
};

/**
 * Fires a workflow through the one internal subject the Trigger Workflow block
 * and the portal's Run button share.
 *
 * The message id is the broker's dedupe key within its duplicate window, so a
 * retried request enqueues the work once. That window is short and covers only
 * our own redelivery — deduplicating the *user's* upstream events is the
 * workflow author's job, with `meta.id` as the tool.
 */
export async function fireInternalTrigger(input: InternalTriggerInput) {
	const { projectId, id, ...message } = input;
	const messageId = id ?? crypto.randomUUID();
	const subject = internalSubject(projectId);

	await publish(subject, message, { msgId: messageId });
	logger.debug(`[triggers] fired ${subject} -> ${message.workflowId}`, "TRIGGERS");
	return { id: messageId };
}

/** Publishes one event onto a trigger row's own subject. */
export async function publishTriggerEvent(
	projectId: string,
	triggerId: string,
	data: unknown,
	messageId?: string,
) {
	await publish(triggerSubject(projectId, triggerId), data, messageId ? { msgId: messageId } : {});
}
