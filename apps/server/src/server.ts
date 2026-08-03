import { initializeLogger, logger } from "@fluxify/common";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mapRouter } from "./modules/requestRouter/router";
import { loadRoutes } from "./loaders/routesLoader";
import { drizzleInit } from "./db";
import { initializeRedis } from "./db/redis";
import { initializePubSub } from "./db/pubsub";
import { loadAppConfig } from "./loaders/appconfigLoader";
import { loadIntegrations } from "./loaders/integrationsLoader";
import { loadProjectSettings } from "./loaders/projectSettingsLoader";
import { loadCustomBlocks, initializeCustomBlocksSubscription } from "./loaders/customBlocksLoader";
import { loadInstanceSettings } from "./loaders/instanceSettingsLoader";
import { mapVersionedAdminRoutes } from "./api/register";
import { errorHandler } from "./middlewares/errorHandler";
import { auth, initializeAuth } from "./lib/auth";
import authenticationRouter from "./api/auth/register";
import { AccessControlRole } from "./db/schema";
import { setSession } from "./middlewares/session";
import { startAiWorker } from "./lib/ai/worker";
import {
	ENABLE_BUILTIN_WORKER,
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	getEnv,
	validateEnv,
} from "./lib/env";

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
				getEnv("TRUSTED_ORIGINS")?.split(",").map((o) => o.trim()) ?? [];
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
	const db = await drizzleInit(adminRoutesEnabled);
	initializeRedis();
	await initializePubSub();

	if (adminRoutesEnabled) {
		app.use("*", setSession);
		await loadInstanceSettings(); // must precede initializeAuth so sso_config is available
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

		// Internal ops bus. Lives here for the same reason as the compile worker:
		// this is the process that owns the database connection.
		const { registerCanvasResponder } = await import("./modules/canvas/rpc");
		registerCanvasResponder();
	}

	if (builtinWorkerEnabled) {
		startAiWorker();
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
