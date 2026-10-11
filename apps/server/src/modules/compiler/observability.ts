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

/**
 * A route's or workflow's switches. `active` is production's and `devActive`
 * development's (#738); production also needs a promoted version (#739), so
 * `active` alone serves nothing.
 */
export type EnvSwitches = {
	active: boolean | null;
	devActive: boolean;
	prodVersionId: string | null;
};

export const isServedIn = (row: EnvSwitches, env: FluxifyEnv) =>
	env === "development" ? row.devActive : row.active === true && row.prodVersionId !== null;

/** What each served environment publishes: its switches and its own build. */
export type PerEnv<T extends object = { source: string }> = Partial<
	Record<FluxifyEnv, Switches & T>
>;

/**
 * Each served environment's switches and build. `build` makes what is specific
 * to the environment (its source, and the graph that source came from — the
 * working copy in development, the promoted version in production); span code
 * is compiled in only where the environment wants spans. It may throw, before
 * anything is published. An environment that is switched off is not built.
 */
export function compilePerEnv<T extends object>(
	row: ObservabilityRow & EnvSwitches,
	build: (env: FluxifyEnv, tracing: boolean) => T,
) {
	const perEnv: PerEnv<T> = {};
	for (const env of ENVIRONMENTS) {
		if (!isServedIn(row, env)) continue;
		const switches = observabilityFor(row, env);
		perEnv[env] = { ...switches, ...build(env, wantsSpans(switches)) };
	}
	return perEnv;
}

/**
 * One artifact per bucket: the shared fields, plus what each environment built.
 * An environment the row is not served in loses its artifact.
 */
export async function putPerEnv<T extends object>(
	key: string,
	artifact: object,
	perEnv: PerEnv<T>,
	row: EnvSwitches,
) {
	await Promise.all(
		ENVIRONMENTS.map((env) => {
			const built = perEnv[env];
			return isServedIn(row, env) && built
				? putArtifact(key, { ...artifact, ...built }, env)
				: deleteArtifact(key, env);
		}),
	);
}
