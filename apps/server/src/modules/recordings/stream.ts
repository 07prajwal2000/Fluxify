import { logger } from "@fluxify/common";
import { ensureStreamOnce, publishToStream, type StreamSpec } from "@fluxify/common/nats";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { natsConnection } from "../../db/nats";
import { FLUXIFY_ENV } from "../../lib/env";

/**
 * Execution recordings (#254) travel on a stream of their own: the worker's
 * supervisor publishes a finished run, the admin's consumer writes it to
 * Postgres. Workers never open Postgres, and the execution process never holds
 * NATS, so this is the only way a recording leaves a worker.
 */

export const RECORDINGS_STREAM = "FLUXIFY_RECORDINGS";
export const RECORDINGS_SUBJECT = "fluxify.recordings";
/** one durable, shared by every admin replica */
export const RECORDINGS_CONSUMER = "fluxify_recordings";

/** Shared by the publisher and the consumer; either may create it. */
export const RECORDINGS_STREAM_SPEC = {
	name: RECORDINGS_STREAM,
	subjects: [RECORDINGS_SUBJECT],
	// one consumer: an acked run has been written and can leave the stream
	retention: "workqueue",
	// A run is worth keeping for as long as an admin restart takes, not longer.
	// Bounded in bytes too, so a busy recorded route can never crowd out
	// artifact delivery on the same NATS (#191): the oldest runs go first.
	maxAgeMs: 24 * 60 * 60_000,
	maxBytes: 512 * 1024 * 1024,
	discard: "old",
	// a run is published once per run id; a retried publish collapses
	duplicateWindowMs: 2 * 60_000,
} satisfies StreamSpec;

let dropped = 0;

/** Runs lost to a failed publish since this process started. */
export const droppedRecordings = () => dropped;

/**
 * Fire and forget. A failed publish drops the run and counts it: recording is
 * a debug tool and must never slow or fail the request that produced it.
 */
export async function publishRecording(run: TraceRunPayload): Promise<void> {
	try {
		const nc = natsConnection();
		await ensureStreamOnce(nc, RECORDINGS_STREAM_SPEC);
		// one stream for both environments (#732): the run says which it came from
		await publishToStream(
			nc,
			RECORDINGS_SUBJECT,
			{ ...run, env: FLUXIFY_ENV },
			{ msgId: run.runId },
		);
	} catch (error) {
		dropped++;
		logger.warn(
			`[recordings] dropped run ${run.runId} (${dropped} so far): ${String(error)}`,
			"RECORDINGS",
		);
	}
}
