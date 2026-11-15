import { expect, it } from "bun:test";
import { aiIntegrationsCache, cacheIntegrations, dbIntegrationsCache } from "../integrationsLoader";

it("skips an integration that can't resolve instead of failing the whole load", () => {
	aiIntegrationsCache.ai1 = { stale: true };
	cacheIntegrations([
		// a restored template: the API key names an app config key with no value
		{ id: "ai1", group: "ai", variant: "OpenAI", projectId: "p", name: "llm", config: { apiKey: "cfg:MISSING", model: "m" } },
		{
			id: "pg1",
			group: "database",
			variant: "PostgreSQL",
			projectId: "p",
			name: "pg",
			config: { source: "credentials", host: "h", port: 5432, username: "u", password: "x", database: "d" },
		},
	]);

	expect(aiIntegrationsCache.ai1).toBeUndefined();
	expect(dbIntegrationsCache.pg1).toMatchObject({ host: "h", database: "d" });
});
