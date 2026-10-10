import type { FluxifyEnv } from "./env";

/** Every environment a value can differ in. The compiler publishes to each. */
export const ENVIRONMENTS: readonly FluxifyEnv[] = ["production", "development"];

/**
 * The stored value an environment uses (#733): production always reads its own,
 * development reads its own unless `syncDev` says to share production's.
 * null = development has no value yet. There is no fallback to production.
 */
export function pickValue<T>(
	env: FluxifyEnv,
	syncDev: boolean | null,
	production: T,
	development: T | null | undefined,
): T | null {
	if (env === "production" || syncDev) return production;
	return development ?? null;
}

/** what a dev worker throws at use, and what admin-side tests tell the user */
export const missingIntegrationMessage = (name: string | null) =>
	`integration ${name ?? "(unnamed)"} has no development value`;
export const missingAppConfigMessage = (key: string) =>
	`app config key ${key} has no development value`;
