/**
 * Child half of resolve.integration.spec.ts.
 *
 * Starts cold — no database, no NATS, no artifacts — so everything it knows
 * comes from the IPC payload. That is the whole claim `resolveSuiteConfig` has
 * to make good on: the payload survives the process boundary and hydrates the
 * same loaders the compiled worker uses.
 */
import {
	getAppConfig,
	hydrateAppConfig,
} from "../../../../loaders/appconfigLoader";
import {
	dbIntegrationsCache,
	hydrateIntegrations,
} from "../../../../loaders/integrationsLoader";

process.on("message", (message: any) => {
	if (message?.type !== "bootstrap") return;
	const { projectId, payload } = message;

	hydrateAppConfig(projectId, payload.appConfig);
	hydrateIntegrations(projectId, {
		db: payload.dbIntegrations,
		kv: payload.kvIntegrations,
		observability: payload.observabilityIntegrations,
		ai: payload.aiIntegrations,
	});

	const integration = dbIntegrationsCache["pg-1"];
	process.send?.({
		type: "hydrated",
		// read back through the same accessors the runtime uses, not the payload
		pgUrl: getAppConfig(projectId, "PG_URL"),
		host: integration?.host,
		database: integration?.database,
		dbType: integration?.dbType,
	});
});

process.send?.({ type: "ready" });
