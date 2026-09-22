import { hostname } from "node:os";
import { initializeLogger, logger } from "@fluxify/common";
import { db, drizzleInit } from "../src/db";
import { closeNats, initializeNats, natsConnected } from "../src/db/nats";
import { nodeClaimsEntity } from "../src/db/schema";
import { watchLicense } from "../src/lib/edition";
import { getEnv } from "../src/lib/env";
import { watchInstanceSettings } from "../src/loaders/instanceSettingsLoader";
import { createDockerDriver } from "../src/modules/orchestrator/drivers/docker";
import { createKubernetesDriver } from "../src/modules/orchestrator/drivers/kubernetes";
import type { InfraDriver } from "../src/modules/orchestrator/drivers/platform";
import { openLeaderLease } from "../src/modules/orchestrator/leader";
import { createReconciler } from "../src/modules/orchestrator/reconciler";

/**
 * The orchestrator. It decides which worker containers should exist and makes
 * the host agree.
 *
 * Its own process, not a flag inside admin (§2): worker lifecycle sitting in
 * the process that also serves the UI, the API and the compiler is a failure
 * nobody can attribute. It reads Postgres directly because it is a control-plane
 * component with admin's privileges — workers are the ones that must never see
 * the database — and that is what lets it rebuild the whole picture from the
 * database when it boots against an empty KV.
 *
 * On Docker it holds the socket, which is root-equivalent on the host, *and*
 * database credentials; on Kubernetes, a service account that may create pods. The narrow command vocabulary in `containerSpec.ts` is
 * therefore load-bearing rather than defence in depth (§13).
 */

const healthPort = Number(getEnv("ORCHESTRATOR_HEALTH_PORT")) || 5800;
const intervalMs = Number(getEnv("ORCHESTRATOR_RECONCILE_INTERVAL_MS")) || 5_000;
const provider = getEnv("ORCHESTRATOR_PROVIDER") || "docker";
const image = getEnv("ORCHESTRATOR_WORKER_IMAGE");
const network = getEnv("ORCHESTRATOR_NETWORK") || "fluxify_net";
const trafficPort = Number(getEnv("WORKER_PORT")) || 5600;
const drainTimeoutSec = Math.ceil(
	(Number(process.env.ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS) || 30_000) / 1_000 + 5,
);

/**
 * Settings a worker container inherits from this process. A fixed list, not
 * "everything in the environment": the container must not receive `PG_URL` — a
 * worker never opens a database connection — and it must not receive this
 * process's own orchestration settings either.
 */
const PASSTHROUGH = [
	"NATS_URL",
	"NATS_TOKEN",
	"REDIS_HOST",
	"REDIS_PORT",
	"REDIS_USER",
	"REDIS_PASS",
	"MASTER_ENCRYPTION_KEY",
	// the portal's playground calls project subdomains cross-origin
	"TRUSTED_ORIGINS",
	"INTEGRATION_TIMEOUT_POLICY_IN_SEC",
	"WORKER_MAX_STREAM_SIZE",
	"ASYNC_EXECUTOR_MAX_IN_FLIGHT",
	"ASYNC_EXECUTOR_MAX_QUEUE_DEPTH",
	"ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS",
	"OTLP_LOGS_ENDPOINT",
	"OTLP_AUTH_HEADER_NAME",
	"OTLP_AUTH_HEADER_VALUE",
	"OTLP_LOGGER_ENABLED",
	"OTLP_LOGGER_LEVEL",
];

initializeLogger({ serviceName: "fluxify.orchestrator" });

if (!image) {
	logger.error(
		"FATAL: ORCHESTRATOR_WORKER_IMAGE is not set. It is the only image this process may create a container from, so there is nothing it could do.",
		"ORCHESTRATOR",
	);
	process.exit(1);
}

/** Admin owns migrations, so a fresh stack is waited out rather than exited. */
async function waitForSchema(maxAttempts = 60, delayMs = 2_000): Promise<void> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await db.select({ id: nodeClaimsEntity.id }).from(nodeClaimsEntity).limit(1);
			return;
		} catch (error) {
			const message = String((error as Error)?.message ?? error);
			if (!message.includes("42P01") && !/does not exist/i.test(message)) throw error;
			logger.info(
				`waiting for database schema (attempt ${attempt}/${maxAttempts})`,
				"ORCHESTRATOR",
			);
			await Bun.sleep(delayMs);
		}
	}
	throw new Error("database schema not ready after waiting for migrations");
}

await drizzleInit();
await waitForSchema();
await initializeNats();
// Both arrive over NATS KV: the license decides what may be claimed, the pool
// ceiling how much of it the host will take. Admin publishes both.
await watchLicense();
await watchInstanceSettings();

const passthroughEnv = Object.fromEntries(
	PASSTHROUGH.map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined),
) as Record<string, string>;

/**
 * The platform, chosen by env rather than detected: an orchestrator running in
 * a cluster but deliberately driving a Docker host is a real setup, and
 * detection would get exactly that case wrong, silently.
 */
function createDriver(): InfraDriver {
	if (provider === "kubernetes") {
		const natsMonitoringEndpoint = getEnv("K8S_NATS_MONITORING_ENDPOINT");
		return createKubernetesDriver({
			image: image!,
			trafficPort,
			healthPort: trafficPort + 1,
			drainTimeoutSec,
			scaleCpuPercent: Number(getEnv("ORCHESTRATOR_SCALE_CPU_PERCENT")) || 65,
			scaleMemoryPercent: Number(getEnv("ORCHESTRATOR_SCALE_MEMORY_PERCENT")) || 65,
			...(natsMonitoringEndpoint ? { natsMonitoringEndpoint } : {}),
			passthroughEnv,
		});
	}
	return createDockerDriver({
		image: image!,
		network,
		trafficPort,
		healthPort: trafficPort + 1,
		drainTimeoutSec,
		passthroughEnv,
		seedsDefaultClaim: getEnv("ORCHESTRATOR_SEED_DEFAULT_CLAIM") !== "false",
	});
}

const MISSING: Record<string, string> = {
	docker: "mount the Docker socket or set DOCKER_HOST",
	kubernetes:
		"run the orchestrator inside the cluster, or set K8S_API_URL and K8S_SA_TOKEN; its service account needs access to the namespace",
};

let driver: InfraDriver;
try {
	driver = createDriver();
} catch (error) {
	// No API server configured at all fails here, before any request is made.
	logger.error(`FATAL: ${provider}: ${String(error)}`, "ORCHESTRATOR");
	process.exit(1);
}
if (!(await driver.reachable())) {
	logger.error(
		`FATAL: the ${driver.provider} platform is not reachable at ${driver.meta.endpoint}. ${MISSING[provider]}.`,
		"ORCHESTRATOR",
	);
	process.exit(1);
}

const holder = `${hostname()}:${process.pid}`;
// Published as the lease value, which is where admin reads it from (§14.5).
const lease = await openLeaderLease(holder, {
	provider: driver.provider,
	reconcileIntervalMs: intervalMs,
	meta: driver.meta,
});
const reconciler = await createReconciler(driver);

let stopping = false;
let leading = false;

const healthServer = Bun.serve({
	port: healthPort,
	fetch: (request) => {
		const path = new URL(request.url).pathname;
		if (path === "/health" || path === "/ready") {
			return natsConnected()
				? Response.json({ status: "ok", leader: leading })
				: Response.json({ status: "nats disconnected" }, { status: 503 });
		}
		return new Response(null, { status: 404 });
	},
});

logger.info(
	`orchestrator ready — reconciling every ${intervalMs}ms, health on http://${healthServer.hostname}:${healthPort}`,
);

let shuttingDown = false;
async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	stopping = true;
	logger.info(`received ${signal} — shutting down`);
	try {
		healthServer.stop(true);
		// Handing the lease back is what makes a planned restart quick: the
		// standby takes over now instead of waiting out the TTL. Worker
		// containers are left running — they are not this process's children,
		// and a deploy of the control plane must not take traffic down.
		await lease.release();
		await closeNats();
	} catch (error) {
		logger.error(`shutdown error: ${String(error)}`);
	} finally {
		process.exit(0);
	}
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * A leader check and a pass, forever. Polling is the floor rather than the
 * mechanism — a missed change costs one interval, and nothing here depends on
 * being told. Registered handlers first: this loop never returns.
 */
while (!stopping) {
	try {
		leading = await lease.tick();
		if (leading) await reconciler.once();
	} catch (error) {
		// A pass that throws is a pass that will be tried again shortly. Exiting
		// would hand the work to a standby with exactly the same problem.
		logger.error(`reconcile pass failed: ${String(error)}`, "ORCHESTRATOR");
	}
	await Bun.sleep(intervalMs);
}
