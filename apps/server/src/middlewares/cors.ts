import { cors } from "hono/cors";
import { getEnv } from "../lib/env";

const OAUTH_DISCOVERY = "/.well-known/oauth-";

export const adminCors = cors({
	origin: (origin, c) => {
		if (!origin) return null;
		// Public OAuth discovery for MCP clients: any site may read it.
		if (c.req.path.startsWith(OAUTH_DISCOVERY)) return "*";
		// dev: any localhost port; prod: explicit TRUSTED_ORIGINS (real DNS behind proxy)
		if (origin.startsWith("http://localhost:")) return origin;
		const trusted =
			getEnv("TRUSTED_ORIGINS")
				?.split(",")
				.map((o) => o.trim()) ?? [];
		return trusted.includes(origin) ? origin : null;
	},
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
	credentials: true,
	maxAge: 86400,
});
