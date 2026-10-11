import { deleteArtifact, putArtifact } from "../../db/natsKv";
import type { FluxifyEnv } from "../../lib/env";
import { ENVIRONMENTS } from "../../lib/envValues";
import { wantsSpans } from "../requestRouter/traceLifecycle";

type Switches = { tracingEnabled: boolean; recordExecution: boolean };

/** A route's or workflow's row: the unprefixed pair is production's (#736). */
export type ObservabilityRow = Switches & {
	devTracingEnabled: boolean;
	devRecordExecution: boolean;
};

/**
 * Observability is per environment, live and never versioned (#736): when
 * versioning lands (#738), these stay on the row and are not part of a version.
 */
export function observabilityFor(row: ObservabilityRow, env: FluxifyEnv): Switches {
	return env === "development"
		? { tracingEnabled: row.devTracingEnabled, recordExecution: row.devRecordExecution }
		: { tracingEnabled: row.tracingEnabled, recordExecution: row.recordExecution };
}

export type PerEnv = Record<FluxifyEnv, Switches & { source: string }>;

/**
 * Each environment's switches and source. Span code is compiled in only where
 * the environment wants spans; two environments that agree share one compile.
 * `compile` may throw, before anything is published.
 */
export function compilePerEnv(row: ObservabilityRow, compile: (tracing: boolean) => string) {
	const sources = new Map<boolean, string>();
	const perEnv = {} as PerEnv;
	for (const env of ENVIRONMENTS) {
		const switches = observabilityFor(row, env);
		const tracing = wantsSpans(switches);
		if (!sources.has(tracing)) sources.set(tracing, compile(tracing));
		perEnv[env] = { ...switches, source: sources.get(tracing)! };
	}
	return perEnv;
}

/** A route's or workflow's two on/off switches: `active` is production, `devActive` development (#738). */
export type EnvSwitches = { active: boolean | null; devActive: boolean };

export const isServedIn = (row: EnvSwitches, env: FluxifyEnv) =>
	env === "development" ? row.devActive : row.active === true;

/**
 * One artifact per bucket: identical but for the environment's own switches and
 * source. An environment the row is switched off for loses its artifact.
 */
export async function putPerEnv(key: string, artifact: object, perEnv: PerEnv, row: EnvSwitches) {
	await Promise.all(
		ENVIRONMENTS.map((env) =>
			isServedIn(row, env)
				? putArtifact(key, { ...artifact, ...perEnv[env] }, env)
				: deleteArtifact(key, env),
		),
	);
}
