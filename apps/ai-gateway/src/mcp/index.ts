import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { Hono } from "hono";
import { logger } from "@fluxify/common";

const mcpServer = new McpServer({
	name: "fluxify-mcp-server",
	version: "0.0.1-alpha",
});

const transport = new StreamableHTTPTransport();

export function mapMcpServer(app: Hono<any>) {
	logger.info("Creating MCP Server");
	app.all(
		"/_/admin/mcp",
		(c, next) => {
			// TODO: auth checks
			return next();
		},
		async (c) => {
			if (!mcpServer.isConnected()) {
				await mcpServer.connect(transport);
			}

			return transport.handleRequest(c);
		},
	);
}
