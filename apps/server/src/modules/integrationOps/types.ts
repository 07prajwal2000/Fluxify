import type { IntegrationOp, IntegrationOpCall } from "@fluxify/adapters/integrations";

/**
 * One op for one project, answered by a worker serving it. Namespaced per
 * environment with `natsName`, so a development request only ever reaches a
 * development worker.
 */
export const integrationOpSubject = (op: IntegrationOp, projectId: string) =>
	`fluxify.integrations.${op}.${projectId}`;

/** one worker answers each request, whichever of the project's workers is free */
export const INTEGRATION_OPS_QUEUE = "fluxify_integration_ops";

/**
 * What crosses the bus, sealed with MASTER_ENCRYPTION_KEY as a test suite is:
 * the stored config can hold a value typed in place of an app config key. App
 * config values never travel; the worker reads its own environment's.
 */
export type IntegrationOpPayload = IntegrationOpCall & {
	projectId: string;
	/** a saved integration's id; absent when testing a config before it is saved */
	integrationId?: string;
	/** the hook's own budget; the admin waits a little longer */
	timeoutMs: number;
};

export type IntegrationOpRequest = { sealed: string };
