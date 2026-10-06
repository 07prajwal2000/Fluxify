import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth, authIssuerUrl, mcpResourceUrl } from "../../lib/auth";
import { anonymousRateLimit } from "../../middlewares/rateLimit";
import type { HonoContext, HonoServer } from "../../types";

const AUTH_BASE = "/_/admin/api/auth";

/**
 * What an MCP client needs before it can sign in: the discovery documents at
 * the host root (both the bare and the path-suffixed forms clients try), and
 * rate limits on the two OAuth endpoints anyone may call signed out.
 * Must be registered before the Better Auth catch-all.
 */
export function mapOAuthRoutes(app: HonoServer) {
	const authServer = (c: HonoContext) => oauthProviderAuthServerMetadata(auth)(c.req.raw);
	app.get("/.well-known/oauth-authorization-server", authServer);
	app.get(`/.well-known/oauth-authorization-server${AUTH_BASE}`, authServer);

	const protectedResource = (c: HonoContext) =>
		c.json({
			resource: mcpResourceUrl(),
			authorization_servers: [authIssuerUrl()],
			bearer_methods_supported: ["header"],
		});
	app.get("/.well-known/oauth-protected-resource", protectedResource);
	app.get("/.well-known/oauth-protected-resource/_/admin/mcp", protectedResource);

	// Same budgets as the plugin's own limiter, which only runs in production.
	app.post(`${AUTH_BASE}/oauth2/register`, anonymousRateLimit("oauth-register", 5));
	app.post(`${AUTH_BASE}/oauth2/token`, anonymousRateLimit("oauth-token", 20));
}
