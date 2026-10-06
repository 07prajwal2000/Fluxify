import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import * as env from "../../lib/env";
import { adminCors } from "../cors";

const envSpy = spyOn(env, "getEnv").mockImplementation(((key: string) =>
	key === "TRUSTED_ORIGINS" ? "https://app.example.com" : undefined) as typeof env.getEnv);
afterAll(() => envSpy.mockRestore());

const app = new Hono();
app.use("*", adminCors);
app.get("*", (c) => c.json({ ok: true }));

const MCP_HEADERS = "authorization,content-type,mcp-protocol-version,mcp-session-id";

function preflight(path: string, origin: string) {
	return app.request(path, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Method": "GET",
			"Access-Control-Request-Headers": MCP_HEADERS,
		},
	});
}

describe("adminCors", () => {
	it("lets any site read the OAuth discovery documents", async () => {
		const res = await preflight("/.well-known/oauth-protected-resource/_/admin/mcp", "https://x.dev");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const allowed = res.headers.get("Access-Control-Allow-Headers")?.toLowerCase().split(",");
		for (const h of MCP_HEADERS.split(",")) expect(allowed).toContain(h);

		const get = await app.request("/.well-known/oauth-authorization-server", {
			headers: { Origin: "https://x.dev" },
		});
		expect(get.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(get.headers.get("Access-Control-Expose-Headers")).toBe("WWW-Authenticate");
	});

	it("keeps the admin API to trusted origins", async () => {
		const untrusted = await preflight("/_/admin/api/v1/projects", "https://x.dev");
		expect(untrusted.headers.get("Access-Control-Allow-Origin")).toBeNull();

		const trusted = await preflight("/_/admin/api/v1/projects", "https://app.example.com");
		expect(trusted.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
	});

	it("does not open other /.well-known paths", async () => {
		const res = await preflight("/.well-known/security.txt", "https://x.dev");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});
