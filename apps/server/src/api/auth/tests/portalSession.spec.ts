import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../../../middlewares/errorHandler";
import { requirePortalSession } from "../middleware";

// A cookie login carries its session token; a bearer grant (personal access
// token, OAuth for MCP, agent run token) is built with an empty one.
function appWith(session: { token: string } | null) {
	const app = new Hono<any>();
	app.onError(errorHandler);
	app.use("*", async (c, next) => {
		c.set("session", session);
		await next();
	});
	app.get("/", requirePortalSession(), (c) => c.json({ ok: true }));
	return app;
}

describe("requirePortalSession", () => {
	it("lets a cookie session through", async () => {
		const res = await appWith({ token: "abc" }).request("/");
		expect(res.status).toBe(200);
	});

	it("refuses a bearer grant, whatever its role", async () => {
		const res = await appWith({ token: "" }).request("/");
		expect(res.status).toBe(403);
	});

	it("refuses no session at all", async () => {
		expect((await appWith(null).request("/")).status).toBe(403);
	});
});
