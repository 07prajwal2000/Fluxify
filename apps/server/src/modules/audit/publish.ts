import { ensureStreamOnce, publishToStream } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { AUDIT_STREAM_SPEC, AUDIT_SUBJECT } from "./stream";
import type { AuditEvent } from "./types";

/**
 * Publishes and waits for the broker's ack. Throws when NATS is down or the
 * stream is full: the caller is a service in the middle of a transaction, and
 * an exception is how the action learns it must roll back.
 */
export async function publishAuditEvent(event: AuditEvent): Promise<void> {
	const nc = natsConnection();
	await ensureStreamOnce(nc, AUDIT_STREAM_SPEC);
	await publishToStream(nc, AUDIT_SUBJECT, event, { msgId: event.id });
}
