import { logger } from "@fluxify/common";
import { exportRun, recordRun } from "@fluxify/common/otlp";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { consumeQueue, ensureStreamConsumer } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { CHAN_ON_INTEGRATION_CHANGE, subscribeToChannel } from "../../db/pubsub";
import {
	meterFor,
	resetProviders,
	resolveDestination,
	tracerFor,
} from "./destinations";
import { TRACE_CONSUMER, TRACE_STREAM, TRACE_SUBJECTS } from "./subjects";

/**
 * The telemetry worker. Drains recorded runs and exports them to whatever OTLP
 * endpoint each project configured.
 *
 * Admin-plane: it holds NATS and a database connection and runs no user code.
 * Nothing here is on the request path — if this process is down, traffic serving
 * is unaffected and runs simply queue until it returns.
 */

let running = false;

export async function startTelemetryWorker() {
	if (running) return;
	const nc = natsConnection();

	await ensureStreamConsumer(
		nc,
		{
			name: TRACE_STREAM,
			subjects: [TRACE_SUBJECTS],
			// Limits, not Workqueue: a work queue permits one consumer per subject
			// and a second one (persisting runs to Postgres) is already planned.
			retention: "limits",
			// 7h. A run is worth exporting for as long as it takes this worker to
			// catch up after a restart, and no longer — days of retention buys
			// nothing and costs disk on the same NATS that carries artifacts.
			maxAgeMs: 7 * 60 * 60_000,
			// telemetry volume must never pressure artifact delivery (#191): cap
			// the bytes and drop the oldest rather than grow without bound
			maxBytes: 512 * 1024 * 1024,
			discard: "old",
		},
		{ durable: TRACE_CONSUMER, ackWaitMs: 30_000, maxDeliver: 3 },
	);

	// A trace is not worth a redelivery loop: a malformed payload or a project
	// with no destination will fail identically every time, and the run has no
	// value once its route has moved on. Ack and drop — unlike the compiler,
	// where an uncompiled route is a broken product.
	await consumeQueue<TraceRunPayload>(
		nc,
		TRACE_STREAM,
		TRACE_CONSUMER,
		(message) => handle(message.data),
		{ failure: "drop" },
	);
	running = true;

	// a rotated credential or moved endpoint must not keep exporting through the
	// connection built from the old config
	await subscribeToChannel(CHAN_ON_INTEGRATION_CHANGE, () => resetProviders());
	logger.info("[telemetry] worker listening", "TELEMETRY");

}

/**
 * Spans are handed to the batch processor and the message is acked immediately
 * after — the network export happens later, off this loop. Acking after the
 * export would make ack latency a user's slow OTLP endpoint, and every project
 * behind it would stall behind that one.
 *
 * The cost is that a crash loses whatever is queued. For telemetry that is the
 * right side of the trade.
 */
export async function handle(run: TraceRunPayload): Promise<void> {
	if (!run?.runId || !run.projectId || !Array.isArray(run.spans)) {
		throw new Error("payload is not a trace run");
	}

	// re-checked here rather than trusted from compile time: a project can remove
	// its integration between the run being recorded and this consuming it
	const [traces, metrics] = await Promise.all([
		resolveDestination(run.projectId, "traces"),
		resolveDestination(run.projectId, "metrics"),
	]);

	if (traces) exportRun(tracerFor(traces), run);
	if (metrics) recordRun(meterFor(metrics), run);

	if (!traces && !metrics) {
		logger.debug(
			`[telemetry] ${run.projectId} has no telemetry destination — dropped run ${run.runId}`,
			"TELEMETRY",
		);
	}
}
