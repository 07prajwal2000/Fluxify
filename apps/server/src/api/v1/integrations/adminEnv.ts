import { BadRequestError } from "../../../errors/badRequestError";
import type { FluxifyEnv } from "../../../lib/env";
import { missingIntegrationMessage, pickValue } from "../../../lib/envValues";

/**
 * The environment an admin-side connection (test, inspect, metadata) uses
 * unless asked otherwise (#733): development, so nobody reaches production by
 * clicking "test". Production is its own explicit action, portal only.
 */
export const ADMIN_CONNECTION_ENV: FluxifyEnv = "development";

export const SET_ONE = 'Set one, or turn on "Same as production".';

/**
 * The config `env` uses for a stored integration. Development with none is a
 * clear 400, never a quiet fall back to production's.
 */
export function configForAdminEnv(
	integration: {
		name: string | null;
		config: unknown;
		devConfig: unknown;
		syncDev: boolean | null;
	},
	env: FluxifyEnv,
) {
	const config = pickValue(env, integration.syncDev, integration.config, integration.devConfig);
	if (config === null) {
		throw new BadRequestError(`${missingIntegrationMessage(integration.name)}. ${SET_ONE}`);
	}
	return config;
}
