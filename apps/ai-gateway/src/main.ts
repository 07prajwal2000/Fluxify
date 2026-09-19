import { logger } from "@fluxify/common";
import { db, errorHandler, initializeAuth, setSession } from "@fluxify/server";
import { serve } from "bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerRoutes } from "./api/register";
import { initializeHarnessSocket, SOCKET_PATH } from "./harness/socketGateway";
import { AI_GATEWAY_PORT } from "./lib/env";
import { mapMcpServer } from "./mcp";

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

	// socket.io streams harness progress from NATS (`conversations.*`) to per-user
	// rooms. It has no Hono adapter, so it shares this one Bun.serve router:
	// the `/_/admin/ai/socket.io/` prefix goes to the engine, everything else to Hono.
	const socket = await initializeHarnessSocket();

	const server = serve({
		port: AI_GATEWAY_PORT,
		idleTimeout: 240, // 4 minutes, bcz of ai workflow
		fetch(req, bunServer) {
			const url = new URL(req.url);
			if (url.pathname.startsWith(SOCKET_PATH)) {
				return socket.fetch(req, bunServer);
			}
			return app.fetch(req, bunServer);
		},
		websocket: socket.websocket,
	});

	logger.info(
		`AI Gateway running at http://${server.hostname}:${server.port} and MCP at /_/admin/mcp`,
	);
}
