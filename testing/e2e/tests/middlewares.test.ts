import { describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * Route middlewares (#534), run through the real HTTP path: a before-middleware
 * that guards with an API key, an after-middleware that stamps the reply, and
 * the route between them. No database, so no container starts.
 */

const guarded = await loadGraph("middlewares/guarded");
const sandwich = await loadGraph("middlewares/sandwich");
const withKey = { headers: { "x-api-key": "secret" }, body: { name: "ann" } };

describe("route middlewares", () => {
	it("runs the before-middleware first and shares its variables with the route", async () => {
		const run = await runGraph(guarded, withKey);

		expect(run.status).toBe(201);
		expect(run.body).toEqual({ hello: "ann", caller: "key-holder" });
		expect(run.executed.indexOf("mw-key-tag")).toBeLessThan(run.executed.indexOf("greet"));
	});

	it("ends the request on the before-middleware's Response", async () => {
		const run = await runGraph(guarded, { body: { name: "ann" } });

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ error: "missing api key" });
		expect(run.executed).not.toContain("greet");
	});

	it("hands the route's reply to the after-middleware, which answers 200", async () => {
		const run = await runGraph(sandwich, withKey);

		expect(run.status).toBe(200);
		expect(run.body).toEqual({
			hello: "ann",
			caller: "key-holder",
			stamped: true,
			routeStatus: 201,
		});
		expect(run.executed).toContain("mw-stamp-header");
	});

	it("still runs the after-middleware when a before-middleware answered", async () => {
		const run = await runGraph(sandwich, { body: { name: "ann" } });

		expect(run.executed).not.toContain("greet");
		expect(run.body).toEqual({ error: "missing api key", stamped: true, routeStatus: 401 });
	});
});
