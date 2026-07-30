import { logger } from "@fluxify/common";
import { AckPolicy, RetentionPolicy, StringCodec } from "nats";
import { natsConnection } from "../../db/nats";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	CHAN_ON_PROJECT_SETTING_CHANGE,
	CHAN_ON_ROUTE_CHANGE,
	subscribeToChannel,
} from "../../db/pubsub";
import type { CompileRequest } from "./artifacts";
import {
	compileAllProjects,
	compileCustomBlock,
	compileProject,
	compileRoute,
	publishAllProjectConfigs,
	publishProjectConfig,
} from "./service";
import {
	requestCustomBlockCompile,
	requestProjectConfigPublish,
	requestRouteCompile,
} from "./publisher";
import {
	ALL_PROJECTS,
	COMPILE_CONSUMER,
	COMPILE_STREAM,
	COMPILE_SUBJECTS,
} from "./subjects";

/**
 * The compile worker. Runs inside the admin server because that is the process
 * that already owns the database connection — request workers must never open
 * one. Compiling is CPU work on the event loop, which is exactly why it does
 * not belong on the nodes serving traffic.
 *
 * A durable pull consumer with explicit acks means a crash mid-compile
 * redelivers rather than silently dropping the route.
 */

const sc = StringCodec();
let running = false;

export async function startCompileWorker() {
	if (running) return;
	const nc = natsConnection();
	const jsm = await nc.jetstreamManager();

	await ensureStream(jsm);
	await ensureConsumer(jsm);

	const consumer = await nc.jetstream().consumers.get(COMPILE_STREAM, COMPILE_CONSUMER);
	const messages = await consumer.consume();
	running = true;
	await bridgeChangeSignals();
	logger.info("[compiler] compile worker listening", "COMPILER");

	// Detached: a large tenant can take a while to compile and the admin API
	// should not wait on it. Workers pick artifacts up as each key lands.
	compileAllProjects()
		.then((count) => logger.info(`[compiler] startup compile: ${count} projects`, "COMPILER"))
		.catch((error) =>
			logger.error(`[compiler] startup compile failed: ${String(error)}`, "COMPILER"),
		);

	(async () => {
		for await (const message of messages) {
			try {
				await handle(message.subject, sc.decode(message.data));
				message.ack();
			} catch (error) {
				logger.error(
					`[compiler] ${message.subject} failed: ${String(error)}`,
					"COMPILER",
				);
				// redelivered after the ack wait — a transient db blip should not
				// leave a route uncompiled forever
				message.nak(5000);
			}
		}
	})();
}

async function handle(subject: string, body: string) {
	const request = JSON.parse(body || "{}") as CompileRequest;
	// fluxify.compile.<kind>.<id>
	const [, , kind, id] = subject.split(".");

	switch (kind) {
		case "route":
			return compileRoute(request.id ?? id);
		case "custom-block":
			return compileCustomBlock(request.id ?? id);
		case "project-config": {
			const projectId = request.projectId ?? id;
			return projectId === ALL_PROJECTS
				? publishAllProjectConfigs()
				: publishProjectConfig(projectId);
		}
		case "project":
			return compileProject(request.projectId ?? id);
		default:
			logger.warn(`[compiler] ignoring unknown subject ${subject}`, "COMPILER");
	}
}

/**
 * Bridges the existing change signals onto the compile queue: saving a route in
 * the admin UI already broadcasts on these channels, so nothing else has to
 * learn about the compiler.
 */
async function bridgeChangeSignals() {
	await subscribeToChannel(CHAN_ON_ROUTE_CHANGE, async (routeId) => {
		if (routeId) await requestRouteCompile(routeId, "route changed");
	});
	await subscribeToChannel(CHAN_ON_CUSTOM_BLOCK_CHANGE, async (id) => {
		if (id) await requestCustomBlockCompile(id, "custom block changed");
	});
	// config feeds integration connection details, so both republish everything
	await subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, () =>
		requestProjectConfigPublish(ALL_PROJECTS, "app config changed"),
	);
	await subscribeToChannel(CHAN_ON_INTEGRATION_CHANGE, () =>
		requestProjectConfigPublish(ALL_PROJECTS, "integrations changed"),
	);
	await subscribeToChannel(CHAN_ON_PROJECT_SETTING_CHANGE, () =>
		requestProjectConfigPublish(ALL_PROJECTS, "project settings changed"),
	);
}

async function ensureStream(jsm: any) {
	try {
		await jsm.streams.add({
			name: COMPILE_STREAM,
			subjects: [COMPILE_SUBJECTS],
			// work queue: a request is removed once acked, so a restart never
			// replays every compile ever asked for
			retention: RetentionPolicy.Workqueue,
			max_age: 24 * 60 * 60 * 1_000_000_000, // 24h in ns
		});
	} catch {
		await jsm.streams.update(COMPILE_STREAM, {
			subjects: [COMPILE_SUBJECTS],
		});
	}
}

async function ensureConsumer(jsm: any) {
	try {
		await jsm.consumers.add(COMPILE_STREAM, {
			durable_name: COMPILE_CONSUMER,
			ack_policy: AckPolicy.Explicit,
			ack_wait: 60 * 1_000_000_000, // compiling a large graph is not instant
			max_deliver: 5,
		});
	} catch {
		// already exists
	}
}
