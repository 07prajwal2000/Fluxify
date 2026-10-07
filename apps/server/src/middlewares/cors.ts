import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { getEnv } from "../lib/env";

const OAUTH_DISCOVERY = "/.well-known/oauth-";
const OAUTH_PUBLIC = ["/_/admin/api/auth/oauth2/token", "/_/admin/api/auth/oauth2/register"];

/** OAuth endpoints MCP clients call from any site. They take no cookies. */
const isPublicOAuth = (path: string) =>
	path.startsWith(OAUTH_DISCOVERY) || OAUTH_PUBLIC.includes(path);

const shared = {
	// The Mcp-* headers and WWW-Authenticate are what browser-based MCP clients
	// send on discovery and read back on a 401.
	allowHeaders: [
		"Content-Type",
		"Authorization",
		"Accept",
		"Mcp-Session-Id",
		"Mcp-Protocol-Version",
	],
	exposeHeaders: ["WWW-Authenticate"],
	allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
	maxAge: 86400,
};

// `*` only works without credentials: browsers reject `*` + Allow-Credentials.
const publicCors = cors({ ...shared, origin: "*" });

const trustedCors = cors({
	...shared,
	origin: (origin) => {
		if (!origin) return null;
		// dev: any localhost port; prod: explicit TRUSTED_ORIGINS (real DNS behind proxy)
		if (origin.startsWith("http://localhost:")) return origin;
		const trusted =
			getEnv("TRUSTED_ORIGINS")
				?.split(",")
				.map((o) => o.trim()) ?? [];
		return trusted.includes(origin) ? origin : null;
	},
	credentials: true,
});

export const adminCors: MiddlewareHandler = (c, next) =>
	isPublicOAuth(c.req.path) ? publicCors(c, next) : trustedCors(c, next);
