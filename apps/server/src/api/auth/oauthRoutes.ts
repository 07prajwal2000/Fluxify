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
	const authServer = async (c: HonoContext) => {
		const meta = await auth.api.getOAuthServerConfig({ headers: c.req.raw.headers });
		c.header(
			"Cache-Control",
			"public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
		);
		return c.json(onServerUrl(meta));
	};
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

/**
 * The plugin builds these from the request's base URL and forces the issuer to
 * https on any host but localhost, so a plain-http server advertised URLs no
 * client could reach. Rebuild every auth URL on SERVER_URL, scheme and all.
 */
export function onServerUrl<T extends object>(meta: T): T {
	const issuer = authIssuerUrl();
	const rebase = (value: unknown) => {
		const at = typeof value === "string" ? value.indexOf(AUTH_BASE) : -1;
		return at < 0 ? value : issuer + (value as string).slice(at + AUTH_BASE.length);
	};
	return Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, rebase(v)])) as T;
}
