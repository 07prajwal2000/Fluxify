import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import { mapMcpServer } from "./mcp";
import { logger } from "@fluxify/common";

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
	mapMcpServer(app);
	const server = serve({
		fetch: app.fetch,
		port: 8001,
	});
	logger.info(
		`AI Gateway running at http://${server.hostname}:${server.port}\nMCP: /_/admin/mcp`,
	);
}
