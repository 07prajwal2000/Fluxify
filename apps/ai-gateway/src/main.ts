import { logger } from "@fluxify/common";
import { db, errorHandler, initializeAuth, setSession } from "@fluxify/server";
import { serve } from "bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerRoutes } from "./api/register";
import { AI_GATEWAY_PORT } from "./lib/env";
import { mapMcpServer } from "./mcp";

export function runMain() {
	const app = new Hono<any>();

	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
			// No allowHeaders: hono echoes the requested ones. "*" never covers
			// Authorization, which MCP clients send.
			exposeHeaders: ["WWW-Authenticate"],
			credentials: true,
		}),
	);

	app.onError(errorHandler);
	app.use("*", setSession);
	mapMcpServer(app);
	registerRoutes(app);
	initializeAuth(db);

	const server = serve({
		port: AI_GATEWAY_PORT,
		idleTimeout: 240, // 4 minutes, bcz of ai workflow
		fetch: app.fetch,
	});

	logger.info(
		`AI Gateway running at http://${server.hostname}:${server.port} and MCP at /_/admin/mcp`,
	);
}
