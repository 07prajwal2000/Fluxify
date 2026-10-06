import { logger } from "@fluxify/common";
import { mcpResourceMetadataUrl } from "@fluxify/server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context, Hono, Next } from "hono";

const mcpServer = new McpServer({
	name: "fluxify-mcp-server",
	version: "0.0.1-alpha",
});

const transport = new StreamableHTTPTransport();

/**
 * MCP acts as a signed-in user only. `setSession` has already resolved the
 * cookie or Bearer token; with no user, point the client at the OAuth
 * discovery document so it can start the sign-in flow.
 */
export async function requireMcpUser(c: Context, next: Next) {
	if (c.get("user")) return next();
	return c.json(
		{ error: "invalid_token", error_description: "Sign in to use the Fluxify MCP server." },
		401,
		{ "WWW-Authenticate": `Bearer resource_metadata="${mcpResourceMetadataUrl()}"` },
	);
}

export function mapMcpServer(app: Hono<any>) {
	logger.info("Creating MCP Server");
	app.all("/_/admin/mcp", requireMcpUser, async (c) => {
		if (!mcpServer.isConnected()) {
			await mcpServer.connect(transport);
		}

		return transport.handleRequest(c);
	});
}
