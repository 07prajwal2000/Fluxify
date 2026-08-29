import { logger } from "@fluxify/common";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { publishToStream } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { traceRunSubject } from "./subjects";

/**
 * Best-effort by design: trace publication must not delay or fail a request.
 * `msgID` makes an IPC resend of the same completed run idempotent in NATS.
 */
export async function publishTraceRun(run: TraceRunPayload): Promise<void> {
	try {
		const subject = traceRunSubject(run.projectId, run.runId);
		await publishToStream(natsConnection(), subject, run, { msgId: run.runId });
	} catch (error) {
		logger.error(
			`[telemetry] failed to publish route run ${run.runId}: ${String(error)}`,
			"TELEMETRY.publish",
		);
	}
}
