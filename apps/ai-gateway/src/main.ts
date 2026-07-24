import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import { mapMcpServer } from "./mcp";
import { logger } from "@fluxify/common";
import { registerRoutes } from "./api/register";
import { db, errorHandler, initializeAuth, setSession } from "@fluxify/server";
import { AI_GATEWAY_PORT } from "./lib/env";
import { startConversationEventBridge } from "./harness/notifications";

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

	// Bridge harness progress from NATS (`conversations.*`) into the in-process
	// event bus for live subscribers (SSE now, socket.io rooms next).
	await startConversationEventBridge();

	const server = serve({
		fetch: app.fetch,
		port: AI_GATEWAY_PORT,
		idleTimeout: 240, // 4 minutes, bcz of ai workflow
	});

	logger.info(
		`AI Gateway running at http://${server.hostname}:${server.port} and MCP at /_/admin/mcp`,
	);
}
