import { createHmac } from "node:crypto";
import { LAG_PER_WORKER } from "@fluxify/sdk/triggers";

/**
 * What a plugin trigger's lag scaling shares between the worker that measures
 * it and the orchestrator that hands it to KEDA.
 */

/** The trigger's `lagPerWorker` when it scales on lag: a stored whole number of at least 1. */
export function lagTargetOf(source: unknown): number | undefined {
	const value = (source as Record<string, unknown> | null | undefined)?.[LAG_PER_WORKER];
	return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/**
 * The source with `lagPerWorker` reduced to "is there one". Its value is the
 * orchestrator's alone: changing it must not restart a running trigger, but
 * turning lag scaling on or off starts or stops the sampler.
 */
export function withoutLagTarget<S extends Record<string, unknown> | undefined>(source: S): S {
	return source && LAG_PER_WORKER in source
		? { ...source, [LAG_PER_WORKER]: lagTargetOf(source) !== undefined }
		: source;
}

/** Where a worker answers KEDA, on its health port: one trigger's lag as `{ "lag": number }`. */
export const lagPath = (triggerId: string) => `/_/admin/api/triggers/${triggerId}/lag`;
export const LAG_PATH = /^\/_\/admin\/api\/triggers\/([A-Za-z0-9_-]{1,64})\/lag$/;

/**
 * The bearer token KEDA presents, derived from the master key so the workers
 * and the orchestrator agree on it with no setting of their own. Derived, so the
 * master key itself never reaches a Secret that KEDA reads.
 */
export function lagMetricsToken(masterKey: string | undefined) {
	if (!masterKey) return "";
	return createHmac("sha256", Buffer.from(masterKey, "base64"))
		.update("fluxify-trigger-lag")
		.digest("hex");
}
