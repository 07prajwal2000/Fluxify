import { logger } from "@fluxify/common";
import { exportRun, recordRun } from "@fluxify/common/otlp";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { AckPolicy, RetentionPolicy, StringCodec } from "nats";
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

const sc = StringCodec();
let running = false;

export async function startTelemetryWorker() {
	if (running) return;
	const nc = natsConnection();
	const jsm = await nc.jetstreamManager();

	await ensureStream(jsm);
	await ensureConsumer(jsm);

	const consumer = await nc.jetstream().consumers.get(TRACE_STREAM, TRACE_CONSUMER);
	const messages = await consumer.consume();
	running = true;

	// a rotated credential or moved endpoint must not keep exporting through the
	// connection built from the old config
	await subscribeToChannel(CHAN_ON_INTEGRATION_CHANGE, () => resetProviders());
	logger.info("[telemetry] worker listening", "TELEMETRY");

	(async () => {
		for await (const message of messages) {
			try {
				await handle(sc.decode(message.data));
				message.ack();
			} catch (error) {
				// A trace is not worth a redelivery loop: a malformed payload or a
				// project with no destination will fail identically every time, and
				// the run has no value once its route has moved on. Ack and drop,
				// unlike the compiler, where an uncompiled route is a broken product.
				logger.error(
					`[telemetry] dropping ${message.subject}: ${String(error)}`,
					"TELEMETRY",
				);
				message.ack();
			}
		}
	})();
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
export async function handle(body: string): Promise<void> {
	const run = JSON.parse(body || "{}") as TraceRunPayload;
	if (!run.runId || !run.projectId || !Array.isArray(run.spans)) {
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

async function ensureStream(jsm: any) {
	const config = {
		name: TRACE_STREAM,
		subjects: [TRACE_SUBJECTS],
		// Limits, not Workqueue: a work queue permits one consumer per subject and
		// a second one (persisting runs to Postgres) is already planned.
		retention: RetentionPolicy.Limits,
		// 7h. A run is worth exporting for as long as it takes this worker to catch
		// up after a restart, and no longer — days of retention buys nothing and
		// costs disk on the same NATS that carries compiled artifacts.
		max_age: 7 * 60 * 60 * 1_000_000_000,
		// telemetry volume must never pressure artifact delivery (#191): cap the
		// bytes and drop the oldest rather than let the store grow without bound
		max_bytes: 512 * 1024 * 1024,
		discard: "old",
	};
	try {
		await jsm.streams.add(config);
	} catch {
		await jsm.streams.update(TRACE_STREAM, config);
	}
}

async function ensureConsumer(jsm: any) {
	try {
		await jsm.consumers.add(TRACE_STREAM, {
			durable_name: TRACE_CONSUMER,
			ack_policy: AckPolicy.Explicit,
			ack_wait: 30 * 1_000_000_000,
			max_deliver: 3,
		});
	} catch {
		// already exists
	}
}
