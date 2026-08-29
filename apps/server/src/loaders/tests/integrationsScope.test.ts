import { describe, expect, it } from "bun:test";
import {
	OWNER_KEY,
	dbIntegrationsCache,
	hydrateIntegrations,
	ownsIntegration,
	scopeToProject,
} from "../integrationsLoader";

const owned = (projectId: string | null) => ({ [OWNER_KEY]: projectId });

describe("integration ownership", () => {
	it("keeps only the project's own integrations", () => {
		const cache = { a: owned("p1"), b: owned("p2"), c: owned(null) };
		// null owner is not project-scoped, so it stays
		expect(Object.keys(scopeToProject(cache, "p1")).sort()).toEqual(["a", "c"]);
	});

	it("rejects a foreign integration", () => {
		expect(ownsIntegration(owned("p2"), "p1")).toBe(false);
		expect(ownsIntegration(undefined, "p1")).toBe(false);
		expect(ownsIntegration(owned("p1"), "p1")).toBe(true);
	});

	// The cache is module-level and `bun test` shares one process, so any other
	// file that hydrates lands in it too. Assert on this test's own keys rather
	// than the whole cache — a full-cache assertion breaks on whoever ran first.
	it("merges per project instead of replacing the cache", () => {
		hydrateIntegrations("p1", { db: { a: owned("p1") } });
		hydrateIntegrations("p2", { db: { b: owned("p2") } });
		expect(dbIntegrationsCache.a).toBeDefined();
		expect(dbIntegrationsCache.b).toBeDefined();

		// re-publishing p1 without `a` drops it, and leaves p2 alone
		hydrateIntegrations("p1", { db: {} });
		expect(dbIntegrationsCache.a).toBeUndefined();
		expect(dbIntegrationsCache.b).toBeDefined();
	});
});
