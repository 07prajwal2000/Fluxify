import { existsSync } from "node:fs";
import { initializeLogger, logger } from "@fluxify/common";
import { healthResponse, markReady } from "../src/modules/requestRouter/health";
import {
	loadProjectArtifacts,
	watchProjectArtifacts,
} from "../src/modules/requestRouter/artifactHost";
import type {
	ThreadBootstrap,
	ThreadMessage,
} from "../src/modules/requestRouter/threadTypes";
import { initializeRedis } from "../src/db/redis";
import { closePubSub, initializePubSub } from "../src/db/pubsub";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	WORKER_PROJECT_ID,
	getEnv,
} from "../src/lib/env";

/**
 * Supervisor for the compiled request worker.
 *
 * It serves no user traffic. Its job is to own the things user code must not
 * reach — the NATS connection, the artifact bucket, MASTER_ENCRYPTION_KEY — and
 * feed execution threads through workerData and postMessage. The threads bind
 * the traffic port themselves with SO_REUSEPORT, so requests are never handed
 * across a thread boundary.
 *
 * Health lives here on its own port: with reusePort a probe sent to the traffic
 * port would be answered by whichever thread the kernel picked, which tells you
 * nothing about the others.
 */

// JSON has no BigInt type; DB bigint columns break JSON.stringify.
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

const port = Number(getEnv("WORKER_PORT")) || 5600;
const healthPort = Number(getEnv("WORKER_HEALTH_PORT")) || port + 1;
/**
 * One execution thread by default. The thread exists for isolation and for
 * being killable, not for parallelism — scaling is horizontal, so a container
 * gets roughly one CPU and extra threads would split it while each pays its own
 * copy of the module graph. Raise this only if you deliberately run fewer,
 * larger containers with several CPUs each.
 */
const threadCount = Number(getEnv("WORKER_THREADS")) || 1;
const databaseIdleTimeoutMs =
	Number(getEnv("INTEGRATION_TIMEOUT_POLICY_IN_SEC") || 450) * 1_000;

initializeLogger({
	serviceName: "fluxify.worker.compiled",
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});

if (!WORKER_PROJECT_ID) {
	logger.error(
		"WORKER_PROJECT_ID is required — set a project id, or * to serve every project",
	);
	process.exit(1);
}

/**
 * `*` serves every project in the bucket. The artifact key filters are already
 * `<kind>.<projectId>.*`, so a literal `*` is a valid KV wildcard and needs no
 * special casing below — it just widens what this worker watches.
 *
 * ponytail: routes from all projects share one route table, so two projects
 * with the same method+path collide. Fine for single-tenant and dev
 * deployments, which is what this is for; per-project routing (host or prefix
 * based) is the upgrade path if it ever has to serve untrusted tenants.
 */
const ALL_PROJECTS = WORKER_PROJECT_ID === "*";

// Project config arrives sealed. Without the key the worker boots fine and then
// fails on every request with no integrations — fail loudly here instead.
if (!getEnv("MASTER_ENCRYPTION_KEY")) {
	logger.error(
		"MASTER_ENCRYPTION_KEY is required — project config artifacts are encrypted",
	);
	process.exit(1);
}

const healthServer = Bun.serve({
	port: healthPort,
	fetch: (request) => healthResponse(request) ?? new Response(null, { status: 404 }),
});
logger.info(`supervisor health on http://${healthServer.hostname}:${healthPort}`);

initializeRedis();
await initializePubSub();

/**
 * Bun's bundler does not pull a worker into the build — it leaves the reference
 * as-is and resolves it at runtime. So the thread is built as its own entry
 * point (see build:worker:compiled) and lands beside this file as .js, while in
 * dev it is still the .ts source two directories up. Pick whichever exists
 * rather than making the deployment carry a path setting.
 */
const bundledThread = new URL("./executionThread.js", import.meta.url);
const threadEntry = existsSync(bundledThread)
	? bundledThread
	: new URL("../src/modules/requestRouter/executionThread.ts", import.meta.url);

const artifacts = await loadProjectArtifacts(WORKER_PROJECT_ID);
const threads: Worker[] = [];

for (let threadId = 0; threadId < threadCount; threadId++) {
	const bootstrap: ThreadBootstrap = {
		threadId,
		projectId: WORKER_PROJECT_ID,
		port,
		databaseIdleTimeoutMs,
		artifacts,
		logging: {
			level: OTLP_LOGGER_LEVEL,
			otlpEndpoint: OTLP_ENDPOINT,
			otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
			useOtlp: OTLP_LOGGER_ENABLED === "true",
		},
	};
	const thread = new Worker(threadEntry, { workerData: bootstrap } as any);
	thread.addEventListener("error", (event: any) =>
		logger.error(`[thread ${threadId}] ${event?.message ?? event}`),
	);
	threads.push(thread);
}

// KV updates are pushed to every thread; each keeps its own route table so a
// request never waits on the supervisor
await watchProjectArtifacts(WORKER_PROJECT_ID, (entry) => {
	const message: ThreadMessage = { type: "artifact", entry };
	for (const thread of threads) thread.postMessage(message);
});

markReady();
logger.info(
	`compiled worker ready — ${threadCount} threads on port ${port}, ${
		ALL_PROJECTS ? "all projects" : `project ${WORKER_PROJECT_ID}`
	}`,
);

let shuttingDown = false;
async function shutdown(sig: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`received ${sig} — shutting down`);
	try {
		await Promise.all(threads.map(stopThread));
		healthServer.stop(true);
		await closePubSub();
	} catch (e) {
		logger.error(`shutdown error: ${e?.toString()}`);
	} finally {
		process.exit(0);
	}
}

function stopThread(thread: Worker) {
	return new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			thread.terminate();
			resolve();
		}, 5_000);
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type !== "stopped") return;
			clearTimeout(timeout);
			thread.removeEventListener("message", onMessage);
			thread.terminate();
			resolve();
		};
		thread.addEventListener("message", onMessage);
		thread.postMessage({ type: "shutdown" } satisfies ThreadMessage);
	});
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
