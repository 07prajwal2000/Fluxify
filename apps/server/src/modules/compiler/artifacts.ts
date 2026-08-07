/**
 * What the compiler publishes and a worker consumes. Everything here must be
 * plain JSON — it round-trips through NATS KV.
 */

/** a route, ready to serve: how to match it, and the JS that runs it */
export type RouteArtifact = {
	routeId: string;
	projectId: string;
	projectName: string;
	method: string;
	path: string;
	bodySchema?: unknown;
	querySchema?: unknown;
	paramsSchema?: unknown;
	timeoutSeconds: number;
	/** body formats this route accepts; anything else is rejected with a 415 */
	acceptedContentTypes: string[];
	/** spans exported to the project's OTEL destination; nothing is stored by us */
	tracingEnabled: boolean;
	/** debug recording, persisted for the portal trace viewer; expensive */
	recordExecution: boolean;
	/**
	 * Identifies the graph a recorded run belongs to. Route versioning is not
	 * built yet, so this is the compile timestamp — a real, distinct value per
	 * publish that the portal can resolve a recorded run against. It becomes the
	 * version id when versioning lands; it travels on the run header, not per span.
	 */
	routeVersion: string;
	/** compiled graph source, instantiated by the worker */
	source: string;
	compiledAt: string;
};

/** a custom block, compiled once and shared by every route in the project */
export type CustomBlockArtifact = {
	id: string;
	name: string;
	projectId: string;
	source: string;
	compiledAt: string;
};

/**
 * Everything the execution context needs that used to come from a database
 * query at worker boot: app config, resolved integration connection details and
 * project settings.
 *
 * These are plaintext database passwords and API keys. They are NOT stored in
 * KV in this form — see ProjectConfigArtifact.
 */
export type ProjectConfigPayload = {
	appConfig: Record<string, string | number | boolean>;
	dbIntegrations: Record<string, any>;
	kvIntegrations: Record<string, any>;
	observabilityIntegrations: Record<string, any>;
	aiIntegrations: Record<string, any>;
	projectSettings: Record<string, string>;
};

/**
 * The config as it actually sits in KV: the payload sealed with
 * MASTER_ENCRYPTION_KEY (AES-256-GCM, the same key that protects these values
 * in Postgres). Anything with read access to the bucket — another tenant's
 * worker, an operator, a leaked NATS credential — sees ciphertext.
 *
 * Both the compiler and the worker need the key in their environment.
 */
export type ProjectConfigArtifact = {
	projectId: string;
	/** base64 AES-256-GCM of JSON.stringify(ProjectConfigPayload) */
	sealed: string;
	compiledAt: string;
};

/**
 * What the supervisor forwards to the isolated execution process. It unseals
 * the config itself, so MASTER_ENCRYPTION_KEY never enters the process that
 * runs user JS — only the resolved values it genuinely needs.
 */
export type UnsealedProjectConfig = {
	projectId: string;
	payload: ProjectConfigPayload;
	compiledAt: string;
};

/** the message body on the compile work queue */
export type CompileRequest = {
	projectId?: string;
	/** route id, custom block id, or absent for a whole-project rebuild */
	id?: string;
	reason?: string;
};
