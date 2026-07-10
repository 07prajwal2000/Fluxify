import { initializeLogger, logger } from "@fluxify/common";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mapRouter } from "./modules/requestRouter/router";
import { loadRoutes } from "./loaders/routesLoader";
import { drizzleInit } from "./db";
import { initializeRedis } from "./db/redis";
import { loadAppConfig } from "./loaders/appconfigLoader";
import { loadIntegrations } from "./loaders/integrationsLoader";
import { loadProjectSettings } from "./loaders/projectSettingsLoader";
import { loadCustomBlocks, initializeCustomBlocksSubscription } from "./loaders/customBlocksLoader";
import { mapVersionedAdminRoutes } from "./api/register";
import { errorHandler } from "./middlewares/errorHandler";
import { auth, initializeAuth } from "./lib/auth";
import authenticationRouter from "./api/auth/register";
import { AccessControlRole } from "./db/schema";
import { setSession } from "./middlewares/session";
import { startAiWorker } from "./lib/ai/worker";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
} from "./lib/env";

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
			if (origin?.startsWith("http://localhost:")) {
				return origin;
			}
			return null;
		},
		allowHeaders: ["Content-Type", "Authorization", "Accept"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
		credentials: true,
		maxAge: 86400,
	}),
);

function logSystemDetails() {
	logger.info(`Admin routes enabled: ${process.env.ENABLE_ADMIN}`);
	logger.info(`Node environment: ${process.env.ENVIRONMENT}`);
}

async function main() {
	initializeLogger({
		serviceName: "fluxify.server",
		level: OTLP_LOGGER_LEVEL,
		otlpEndpoint: OTLP_ENDPOINT,
		otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
		useOtlp: OTLP_LOGGER_ENABLED === "true",
	});
	logSystemDetails();
	const adminRoutesEnabled = process.env.ENABLE_ADMIN == "true";
	app.onError(errorHandler);
	const db = await drizzleInit(adminRoutesEnabled);
	await initializeRedis();
	startAiWorker();

	if (adminRoutesEnabled) {
		app.use("*", setSession);
		initializeAuth(db);
		authenticationRouter.registerHandler(app);
		mapVersionedAdminRoutes(app);
		
		// Seed data if admin routes are enabled
		const { seedData } = await import("./db/seed");
		await seedData(db);
	}
	await loadAppConfig();
	await loadIntegrations();
	await loadProjectSettings();
	await loadCustomBlocks();
	initializeCustomBlocksSubscription();
	const parser = await loadRoutes();
	await mapRouter(app, parser);
}
if (process.env.NODE_ENV !== "test") {
	await main();
}

export { app };
