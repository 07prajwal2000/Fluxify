import { logger } from "@fluxify/common";
import {
	consumeBatches,
	ensureStreamConsumer,
	type FluxifyQueueConsumer,
} from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { onSystemTick } from "../schedules/system";
import { deleteExpiredAuditEvents } from "./retention";
import { postgresAuditSink } from "./sink";
import { AUDIT_CONSUMER, AUDIT_STREAM, AUDIT_STREAM_SPEC } from "./stream";
import { type AuditEvent, type AuditSink, auditEventSchema } from "./types";

/**
 * The audit consumer (#833). Admin only: it writes Postgres, which no worker
 * may open. Shared durable, so any number of admins split the stream.
 */

const MAX_DELIVER = 5;
export const BATCH_SIZE = 500;
export const BATCH_WAIT_MS = 2_000;

/**
 * Validates and writes one batch. An event that does not parse fails the same
 * way on every redelivery, so it is dropped here rather than blocking the batch.
 * A database error throws, which naks the batch for another try.
 */
export async function writeAuditBatch(
	events: unknown[],
	sink: AuditSink = postgresAuditSink,
): Promise<number> {
	const valid: AuditEvent[] = [];
	for (const event of events) {
		const parsed = auditEventSchema.safeParse(event);
		if (parsed.success) valid.push(parsed.data);
		else logger.warn("[audit] dropped a malformed event", "AUDIT");
	}
	if (valid.length) await sink.insert(valid);
	return valid.length;
}

export async function startAuditConsumer(): Promise<FluxifyQueueConsumer[]> {
	const nc = natsConnection();
	// not caught: NATS is a hard dependency, and an admin that silently
	// writes no audit trail is worse than one that refuses to boot
	await ensureStreamConsumer(nc, AUDIT_STREAM_SPEC, {
		durable: AUDIT_CONSUMER,
		ackWaitMs: 30_000,
		maxDeliver: MAX_DELIVER,
	});
	const writer = await consumeBatches<unknown>(
		nc,
		AUDIT_STREAM,
		AUDIT_CONSUMER,
		async (batch) => void (await writeAuditBatch(batch.map((m) => m.data))),
		{
			maxMessages: BATCH_SIZE,
			maxBytes: 16 * 1024 * 1024,
			maxWaitMs: BATCH_WAIT_MS,
			maxAttempts: MAX_DELIVER,
		},
	);
	const retention = await onSystemTick("daily", "audit-retention", async () => {
		await deleteExpiredAuditEvents();
	});
	logger.info("[audit] consumer listening", "AUDIT");
	return [writer, retention];
}
