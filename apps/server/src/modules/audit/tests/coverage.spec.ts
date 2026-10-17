import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import authRegister from "../../../api/auth/register";
import { mapVersionedAdminRoutes } from "../../../api/register";
import { AUDITED, SKIPPED } from "./coverage";

const SRC = join(import.meta.dir, "../../..");
const PREFIX = "/_/admin/api";

/** One key per non-GET route: its operationId, or `METHOD /path` when it has none. */
function mutatingRoutes() {
	const app = new Hono() as any;
	authRegister.registerHandler(app);
	mapVersionedAdminRoutes(app);
	const keys = new Map<string, string>();
	for (const route of app.routes) {
		if (route.method === "GET") continue;
		const where = `${route.method} ${route.path.replace(PREFIX, "")}`;
		// describeRoute hangs its options off a symbol on the middleware it returns
		const described = Object.getOwnPropertySymbols(route.handler)
			.map((s) => route.handler[s]?.spec?.operationId ?? route.handler[s]?.operationId)
			.find(Boolean);
		keys.set(where, described ?? keys.get(where) ?? where);
	}
	return [...keys.values()];
}

describe("admin API audit coverage", () => {
	const routes = mutatingRoutes();

	it("finds the mutating routes at all", () => {
		expect(routes.length).toBeGreaterThan(60);
	});

	it("audits or skips every non-GET route", () => {
		const unhandled = routes.filter((key) => !(key in AUDITED) && !(key in SKIPPED));
		expect(unhandled).toEqual([]);
	});

	it("lists no route twice or one that no longer exists", () => {
		const both = Object.keys(AUDITED).filter((key) => key in SKIPPED);
		expect(both).toEqual([]);
		const known = new Set(routes);
		const stale = [...Object.keys(AUDITED), ...Object.keys(SKIPPED)].filter(
			(key) => !known.has(key),
		);
		expect(stale).toEqual([]);
	});

	it("points every audited route at a file that calls audit.record", () => {
		const missing = Object.entries(AUDITED).filter(([, file]) => {
			const path = join(SRC, file);
			return !existsSync(path) || !readFileSync(path, "utf8").includes("audit.record(");
		});
		expect(missing).toEqual([]);
	});

	it("gives every skipped route a reason", () => {
		expect(Object.entries(SKIPPED).filter(([, why]) => why.trim().length < 10)).toEqual([]);
	});
});
