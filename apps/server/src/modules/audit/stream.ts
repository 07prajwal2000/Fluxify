import type { StreamSpec } from "@fluxify/common/nats";

export const AUDIT_STREAM = "FLUXIFY_AUDIT";
export const AUDIT_SUBJECT = "fluxify.audit";
/** one durable, shared by every admin replica */
export const AUDIT_CONSUMER = "fluxify_audit";

export const AUDIT_STREAM_SPEC = {
	name: AUDIT_STREAM,
	subjects: [AUDIT_SUBJECT],
	// one consumer: an acked event has been written and can leave the stream
	retention: "workqueue",
	// Long enough to ride out an admin outage. `discard: new` on purpose: when
	// the stream is full the publish fails and so does the action, rather than
	// an event being dropped silently (the audit failure policy).
	maxAgeMs: 7 * 24 * 60 * 60_000,
	maxBytes: 512 * 1024 * 1024,
	discard: "new",
	// the event id is the message id, so a retried publish collapses
	duplicateWindowMs: 2 * 60_000,
} satisfies StreamSpec;
