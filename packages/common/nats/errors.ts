import { JetStreamApiError, JetStreamApiCodes } from "@nats-io/jetstream";

/**
 * The v2 client had one `NatsError` and callers told cases apart by string
 * matching, which is why the pre-migration code wrapped every `streams.add` in
 * a bare `catch {}` — swallowing bad credentials and disabled JetStream along
 * with the harmless "already exists". v3 throws typed errors with API codes, so
 * "does not exist" is now separable from "something is actually wrong".
 */

export function isJetStreamApiError(error: unknown): error is JetStreamApiError {
	return error instanceof JetStreamApiError;
}

function hasCode(error: unknown, code: number): boolean {
	return isJetStreamApiError(error) && error.code === code;
}

export function isStreamNotFound(error: unknown): boolean {
	return hasCode(error, JetStreamApiCodes.StreamNotFound);
}

export function isConsumerNotFound(error: unknown): boolean {
	return hasCode(error, JetStreamApiCodes.ConsumerNotFound);
}

export function isJetStreamNotEnabled(error: unknown): boolean {
	return hasCode(error, JetStreamApiCodes.JetStreamNotEnabledForAccount);
}

/**
 * The optimistic-concurrency failure: a conditional write lost the race. KV's
 * put-if-absent and compare-and-set both surface as this, and both treat it as
 * an ordinary outcome rather than an error.
 */
export function isWrongLastSequence(error: unknown): boolean {
	return (
		hasCode(error, JetStreamApiCodes.StreamWrongLastSequence) ||
		hasCode(error, JetStreamApiCodes.StreamWrongLastSequenceUnknown)
	);
}

export { JetStreamApiError, JetStreamApiCodes };
