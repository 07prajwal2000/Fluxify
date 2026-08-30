import { logger } from "@fluxify/common";
import { consumeQueue, ensureStreamConsumer } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_WORKFLOW_CHANGE,
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
	compileWorkflow,
	publishAllProjectConfigs,
	publishProjectConfig,
} from "./service";
import {
	requestCustomBlockCompile,
	requestProjectConfigPublish,
	requestRouteCompile,
	requestWorkflowCompile,
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

let running = false;

export async function startCompileWorker() {
	if (running) return;
	const nc = natsConnection();

	await ensureStreamConsumer(
		nc,
		{
			name: COMPILE_STREAM,
			subjects: [COMPILE_SUBJECTS],
			// work queue: a request is removed once acked, so a restart never
			// replays every compile ever asked for
			retention: "workqueue",
			maxAgeMs: 24 * 60 * 60_000,
		},
		{
			durable: COMPILE_CONSUMER,
			ackWaitMs: 60_000, // compiling a large graph is not instant
			maxDeliver: 5,
		},
	);

	// A transient db blip must not leave a route uncompiled forever, so a throw
	// is retried rather than dropped.
	await consumeQueue<CompileRequest>(
		nc,
		COMPILE_STREAM,
		COMPILE_CONSUMER,
		(message) => handle(message.subject, message.data),
		{ failure: "retry", maxAttempts: 5, retryDelayMs: 5000 },
	);
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

}

async function handle(subject: string, request: CompileRequest) {
	// fluxify.compile.<kind>.<id>
	const [, , kind, id] = subject.split(".");

	switch (kind) {
		case "route":
			return compileRoute(request.id ?? id);
		case "custom-block":
			return compileCustomBlock(request.id ?? id);
		case "workflow":
			return compileWorkflow(request.id ?? id);
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
	await subscribeToChannel(CHAN_ON_WORKFLOW_CHANGE, async (id) => {
		if (id) await requestWorkflowCompile(id, "workflow changed");
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
