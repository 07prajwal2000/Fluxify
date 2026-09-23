import { initializeLogger, logger } from "@fluxify/common";
import { Hono } from "hono";
import { cors } from "hono/cors";
import authenticationRouter from "./api/auth/register";
import { mapVersionedAdminRoutes } from "./api/register";
import { publishConfiguredLicense } from "./api/v1/instance-settings/license/service";
import { drizzleInit } from "./db";
import { initializePubSub } from "./db/pubsub";
import { initializeRedis, pingRedis } from "./db/redis";
import type { AccessControlRole } from "./db/schema";
import { type auth, initializeAuth } from "./lib/auth";
import {
	ENABLE_BUILTIN_WORKER,
	getEnv,
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	validateEnv,
} from "./lib/env";
import { waitFor } from "./lib/waitFor";
import { loadAppConfig } from "./loaders/appconfigLoader";
import { initializeCustomBlocksSubscription, loadCustomBlocks } from "./loaders/customBlocksLoader";
import { loadInstanceSettings } from "./loaders/instanceSettingsLoader";
import { loadIntegrations } from "./loaders/integrationsLoader";
import { loadProjectSettings } from "./loaders/projectSettingsLoader";
import { loadRoutes } from "./loaders/routesLoader";
import { errorHandler } from "./middlewares/errorHandler";
import { adminRateLimit } from "./middlewares/rateLimit";
import { setSession } from "./middlewares/session";
import { mapRouter } from "./modules/requestRouter/router";

// JSON has no BigInt type; DB drivers return bigint columns as BigInt, which
// makes JSON.stringify (and Hono's c.json) throw. Serialize as string to avoid
// precision loss on values above Number.MAX_SAFE_INTEGER.
// ponytail: global prototype patch, the standard bigint-serialization fix
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null;
		acl: { projectId: string; role: AccessControlRole }[] | null;
	};
}>();

// Global CORS middleware
app.use(
	"*",
	cors({
		origin: (origin) => {
			if (!origin) return null;
			// dev: any localhost port; prod: explicit TRUSTED_ORIGINS (real DNS behind proxy)
			if (origin.startsWith("http://localhost:")) return origin;
			const trusted =
				getEnv("TRUSTED_ORIGINS")
					?.split(",")
					.map((o) => o.trim()) ?? [];
			return trusted.includes(origin) ? origin : null;
		},
		allowHeaders: ["Content-Type", "Authorization", "Accept"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
		credentials: true,
		maxAge: 86400,
	}),
);

function logSystemDetails() {
	logger.info(`Admin routes enabled: ${getEnv("ENABLE_ADMIN")}`);
	logger.info(`Node environment: ${getEnv("ENVIRONMENT")}`);
}

async function main() {
	validateEnv();
	initializeLogger({
		serviceName: "fluxify.server",
		level: OTLP_LOGGER_LEVEL,
		otlpEndpoint: OTLP_ENDPOINT,
		otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
		useOtlp: OTLP_LOGGER_ENABLED === "true",
	});
	logSystemDetails();
	const adminRoutesEnabled = getEnv("ENABLE_ADMIN") == "true";
	// When false, this process is control-plane only — a separate worker node
	// loads configs/blocks/routes and serves user APIs. Admin still publishes
	// change events over NATS so that worker hot-reloads.
	const builtinWorkerEnabled = ENABLE_BUILTIN_WORKER == "true";
	logger.info(`Builtin worker enabled: ${ENABLE_BUILTIN_WORKER}`);
	app.onError(errorHandler);
	// Postgres, Redis and NATS may still be starting on a fresh install (#463).
	const db = await waitFor("Postgres", () => drizzleInit(adminRoutesEnabled));
	initializeRedis();
	await waitFor("Redis", pingRedis);
	await waitFor("NATS", initializePubSub);

	if (adminRoutesEnabled) {
		app.use("*", setSession);
		// Scoped to the admin prefix, not "*": when the builtin worker runs in
		// this process the public compiled routes share this app and must not be
		// capped by a control-plane limit.
		app.use("/_/admin/api/*", adminRateLimit);
		await loadInstanceSettings(); // must precede initializeAuth so sso_config is available
		await publishConfiguredLicense();
		initializeAuth(db);
		authenticationRouter.registerHandler(app);
		mapVersionedAdminRoutes(app);

		// Seed data if admin routes are enabled
		const { seedData } = await import("./db/seed");
		await seedData(db);

		// The compile worker lives here because this is the process that owns the
		// database connection — request workers must never open one, and compiling
		// is CPU work that has no business on a node serving traffic.
		await loadAppConfig();
		await loadIntegrations();
		await loadProjectSettings();
		const { startCompileWorker } = await import("./modules/compiler/consumer");
		await startCompileWorker();

		// Test runs are queued in memory, so anything left queued/running belongs
		// to a process that no longer exists.
		const { sweepStrandedTestRuns } = await import("./modules/testRunner/sweep");
		await sweepStrandedTestRuns();

		// Internal ops bus. Lives here for the same reason as the compile worker:
		// this is the process that owns the database connection.
		const { registerCanvasResponder } = await import("./modules/canvas/rpc");
		const { registerRouteResponder } = await import("./modules/ops/route");
		const { registerCustomBlockResponder } = await import("./modules/ops/customBlock");
		const { registerWorkflowResponder } = await import("./modules/ops/workflow");
		const { registerTriggerFaultResponder } = await import("./modules/ops/triggerFault");
		const { registerClaimEditResponder } = await import("./modules/ops/claimEdit");
		registerTriggerFaultResponder();
		registerClaimEditResponder();
		registerCanvasResponder();
		registerRouteResponder();
		registerCustomBlockResponder();
		registerWorkflowResponder();

		// Postgres is authoritative for schedules; the broker is what fires them.
		// Bringing the two back in line is this node's job because it is the one
		// holding the database connection.
		const { loadSchedules } = await import("./loaders/schedulesLoader");
		await loadSchedules();
	}

	if (builtinWorkerEnabled) {
		await loadAppConfig();
		await loadIntegrations();
		await loadProjectSettings();
		// hot reload of compiled artifacts is the compiled worker's job; the
		// builtin worker keeps interpreting so both paths stay exercised
		await loadCustomBlocks();
		initializeCustomBlocksSubscription();
		const parser = await loadRoutes();
		await mapRouter(app, parser);
	}
}
if (getEnv("NODE_ENV") !== "test") {
	await main();
}

export { app };
