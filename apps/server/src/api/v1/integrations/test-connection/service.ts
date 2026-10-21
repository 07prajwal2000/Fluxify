import { expandCfg, type McpOAuth, type OtlpSignal } from "@fluxify/adapters";
import type { z } from "zod";
import type { FluxifyEnv } from "../../../../lib/env";
import { audit } from "../../../../modules/audit";
import { decodeAppConfig } from "../../../../modules/integrationOps/appConfig";
import { runIntegrationOp } from "../../../../modules/integrationOps/dispatch";
import { ADMIN_CONNECTION_ENV } from "../adminEnv";
import { getAppConfigKeysFromData } from "../create/service";
import type { requestBodySchema, responseSchema } from "./dto";

export { decodeAppConfig };

type Result = z.infer<typeof responseSchema>;

export const CONNECTION_TEST_TIMEOUT_MS = 10_000;

/**
 * Always answers with the reason (#672). Some probes throw (an AI provider
 * refusing the key) and some never settle (a host that drops packets), and both
 * used to reach the caller as a bare 500 or a hang, with the cause lost.
 *
 * The probe is the variant's `test` hook, run here or on a worker of `env`
 * (`runIntegrationOp`).
 */
export async function testIntegrationConnection(
	projectId: string,
	group: string,
	variant: string,
	config: any,
	/** which signal to probe; observability only, defaults to logs */
	signal: OtlpSignal = "logs",
	timeoutMs = CONNECTION_TEST_TIMEOUT_MS,
	/** whose app config values `cfg:` references read */
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
	/** mcp only: the stored OAuth connection of a saved integration */
	oauth?: McpOAuth,
	/** a saved integration's id */
	integrationId?: string,
): Promise<Result> {
	try {
		return (await runIntegrationOp(
			"test",
			{ projectId, env, integrationId, group, variant, config, options: { signal, oauth } },
			{ timeoutMs },
		)) as Result;
	} catch (error) {
		return {
			success: false,
			error: (error instanceof Error ? error.message : String(error)) || "Connection failed",
		};
	}
}

export default async function handleRequest(
	projectId: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<Result> {
	const result = await testIntegrationConnection(projectId, body.group, body.variant, body.config);
	await audit.record({
		projectId,
		resourceType: "integration",
		resourceId: `${body.group}:${body.variant}`,
		action: "test",
		changedFields: [],
		status: result.success ? "success" : "failure",
		// the reason a probe failed; scrubbed of anything credential-shaped on the way in
		...(result.success ? {} : { message: result.error }),
	});
	return result;
}

/** A stored queue integration's config with its `cfg:` references resolved. */
export async function resolveQueueConfig(
	projectId: string,
	config: Record<string, unknown>,
	env: FluxifyEnv,
) {
	const appConfigs = await decodeAppConfig(getAppConfigKeysFromData(config), projectId, env);
	return expandCfg(config, appConfigs);
}
