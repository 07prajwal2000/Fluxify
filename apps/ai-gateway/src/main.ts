import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import { mapMcpServer } from "./mcp";
import { logger } from "@fluxify/common";
import { registerRoutes } from "./api/register";
import { db, errorHandler, initializeAuth, setSession } from "@fluxify/server";
import { AI_GATEWAY_PORT } from "./lib/env";

export async function runMain() {
	const app = new Hono<any>();

	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["*"],
			credentials: true,
		}),
	);

	app.onError(errorHandler);
	app.use("*", setSession);
	mapMcpServer(app);
	registerRoutes(app);
	initializeAuth(db);

	const server = serve({
		fetch: app.fetch,
		port: AI_GATEWAY_PORT,
		idleTimeout: 60 * 5, // 5 minutes, bcz of ai workflow
	});

	logger.info(
		`AI Gateway running at http://${server.hostname}:${server.port} and MCP at /_/admin/mcp`,
	);
}
