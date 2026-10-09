import { logger } from "@fluxify/common";
import { mcpResourceMetadataUrl } from "@fluxify/server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context, Hono, Next } from "hono";
import { type AdminFetch, adminApi, httpAdminFetch } from "./adminApi";
import { canvasTools } from "./canvasTools";
import { docsTools } from "./docsTools";
import { MCP_INSTRUCTIONS } from "./instructions";
import { projectTools } from "./projectTools";
import { routeTools } from "./routeTools";
import { testSuiteTools } from "./testSuiteTools";
import { lenient, readTools } from "./tools";
import { writeTools } from "./writeTools";

/** Who the MCP call acts as: what `setSession` put on the request. */
export type McpCaller = {
	id: string;
	email: string;
	isSystemAdmin: boolean;
	acl: { projectId: string; role: string }[];
};

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

/**
 * One server per request, so a tool only ever sees its own caller. `auth` is
 * the caller's own credential header, forwarded on every admin API call.
 */
export function createMcpServer(
	caller: McpCaller,
	auth: Record<string, string> = {},
	fetcher: AdminFetch = httpAdminFetch,
) {
	const server = new McpServer(
		{ name: "fluxify-mcp-server", version: "0.0.1-alpha" },
		{ instructions: MCP_INSTRUCTIONS },
	);
	server.registerTool(
		"whoami",
		{
			title: "Who am I",
			description:
				"The Fluxify user this connection acts as, and their project roles. Use it to check sign-in.",
			annotations: { readOnlyHint: true },
		},
		async () => ({ content: [{ type: "text", text: JSON.stringify(caller) }] }),
	);
	for (const tool of [
		...readTools,
		...writeTools,
		...routeTools,
		...canvasTools,
		...projectTools,
		...testSuiteTools,
		...docsTools,
	]) {
		const api = adminApi(fetcher, auth, tool.role);
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: lenient(tool.input),
				annotations: tool.annotations ?? { readOnlyHint: true },
			},
			async (args: unknown) => {
				const result = await tool.call(api, args);
				const text = typeof result === "string" ? result : JSON.stringify(result);
				return { content: [{ type: "text", text }] };
			},
		);
	}
	return server;
}

function callerOf(c: Context): McpCaller {
	const user = c.get("user");
	return {
		id: user.id,
		email: user.email,
		isSystemAdmin: Boolean(user.isSystemAdmin),
		acl: (c.get("acl") ?? []).map((a: McpCaller["acl"][number]) => ({
			projectId: a.projectId,
			role: a.role,
		})),
	};
}

/** The caller's credential, exactly as they sent it, for the admin API to check. */
function authOf(c: Context) {
	const auth: Record<string, string> = {};
	for (const name of ["authorization", "cookie"]) {
		const value = c.req.header(name);
		if (value) auth[name] = value;
	}
	return auth;
}

export function mapMcpServer(app: Hono<any>, fetcher: AdminFetch = httpAdminFetch) {
	logger.info("Creating MCP Server");
	// Stateless: no session to resume, so only POST. GET (a standalone SSE
	// stream) and DELETE (end a session) have nothing to serve.
	app.post("/_/admin/mcp", requireMcpUser, async (c) => {
		const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
		await createMcpServer(callerOf(c), authOf(c), fetcher).connect(transport);
		return transport.handleRequest(c);
	});
	app.on(["GET", "DELETE"], "/_/admin/mcp", requireMcpUser, (c) =>
		c.json({ error: "method_not_allowed" }, 405, { Allow: "POST" }),
	);
}
