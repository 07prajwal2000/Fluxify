import { describe, expect, it, mock } from "bun:test";

const PROJECT = "p1";

// One postgres integration whose url is a `cfg:` reference — the whole point of
// the ordering rule is that this reference sees the overridden value.
const rows = [
	{
		id: "pg-1",
		group: "database",
		variant: "PostgreSQL",
		config: { source: "url", url: "cfg:PG_URL" },
		projectId: PROJECT,
	},
	{
		id: "pg-2",
		group: "database",
		variant: "PostgreSQL",
		config: {
			source: "url",
			url: "postgres://sand:sand@sandbox:5432/sanddb",
		},
		projectId: PROJECT,
	},
];

mock.module("../../../db", () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => rows }) }),
	},
}));

const { resolveSuiteConfig } = await import("../resolve");
const { hydrateAppConfig } = await import("../../../loaders/appconfigLoader");

hydrateAppConfig(PROJECT, {
	PG_URL: "postgres://real:real@prod-host:5432/proddb",
});

describe("resolveSuiteConfig", () => {
	it("resolves integrations against the OVERRIDDEN app config", async () => {
		const payload = await resolveSuiteConfig(PROJECT, {
			appConfigOverrides: [
				{ key: "PG_URL", value: "postgres://test:test@test-host:5432/testdb" },
			],
		});

		// Flip the order (integrations before app configs) and this is "prod-host".
		expect(payload.dbIntegrations["pg-1"].host).toBe("test-host");
		expect(payload.dbIntegrations["pg-1"].database).toBe("testdb");
		expect(payload.appConfig.PG_URL).toBe(
			"postgres://test:test@test-host:5432/testdb",
		);
	});

	it("resolves to the live config when there are no overrides", async () => {
		const payload = await resolveSuiteConfig(PROJECT, {});
		expect(payload.dbIntegrations["pg-1"].host).toBe("prod-host");
		expect(payload.dbIntegrations["pg-1"].dbType).toBe("pg");
	});

	it("swaps an integration id for the override target", async () => {
		const payload = await resolveSuiteConfig(PROJECT, {
			integrationOverrides: [{ existingId: "pg-1", newId: "pg-2" }],
		});
		expect(payload.dbIntegrations["pg-1"].host).toBe("sandbox");
	});

	it("throws when the override target does not exist", async () => {
		expect(
			resolveSuiteConfig(PROJECT, {
				integrationOverrides: [{ existingId: "pg-1", newId: "nope" }],
			}),
		).rejects.toThrow(/"nope" was not found/);
	});
});
