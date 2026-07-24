import type { TriggerContext } from "@fluxify/blocks";

export type RequestOverrides = {
	integrations?: Array<{ existingId: string; newId: string }>;
	appConfigs?: Array<{ key: string; value: string }>;
};

/**
 * Generic, transport-agnostic request the worker executes. The HTTP-shaped
 * fields stay because routes are matched on method + path, but they are plain
 * data: a NATS/BullMQ producer fills them synthetically (e.g. path = job name,
 * headers = message metadata). Nothing here depends on Hono or on being an
 * actual HTTP request.
 */
export type RequestPayload = {
	method: string;
	path: string;
	headers: Record<string, string>;
	query: Record<string, string | string[]>;
	body: any;
	/** route params; usually filled by the router after matching */
	params?: Record<string, string>;
};

export type RequestEnvelope = {
	/** where it came from + how to reply (sync/async) */
	trigger: TriggerContext;
	payload: RequestPayload;
	overrides?: RequestOverrides;
};
