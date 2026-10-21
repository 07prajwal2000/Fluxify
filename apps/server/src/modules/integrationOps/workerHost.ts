import {
	INTEGRATION_OPS,
	IntegrationOpError,
	type IntegrationRegistry,
	integrationRegistry,
	runIntegrationHook,
} from "@fluxify/adapters/integrations";
import { RpcError, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { SET_ONE } from "../../api/v1/integrations/adminEnv";
import { natsConnection, natsName } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import { missingAppConfigMessage } from "../../lib/envValues";
import type { ProjectConfigPayload } from "../compiler/artifacts";
import {
	INTEGRATION_OPS_QUEUE,
	type IntegrationOpPayload,
	type IntegrationOpRequest,
	integrationOpSubject,
} from "./types";

/**
 * The worker half of an integration op (I3): one project's Test connection,
 * metadata and inspect, run through this worker's registry against its own
 * environment's app config. `projectConfig` is the project's published config
 * as this worker holds it.
 *
 * ponytail: hooks run in the supervisor; built-ins only until I6 decides where
 * plugin variants' hooks run (the execution child keeps plugin code away from
 * MASTER_ENCRYPTION_KEY, which the supervisor holds).
 */
export function serveIntegrationOps(
	projectId: string,
	env: FluxifyEnv,
	projectConfig: (projectId: string) => ProjectConfigPayload | undefined,
	registry: IntegrationRegistry = integrationRegistry,
): RpcResponder {
	const responders = INTEGRATION_OPS.map((op) =>
		rpcRespond<IntegrationOpRequest, unknown>(
			natsConnection(),
			natsName(integrationOpSubject(op, projectId), env),
			async ({ sealed }) => {
				const call: IntegrationOpPayload = JSON.parse(EncryptionService.decrypt(sealed));
				// the subject already scopes it; a mismatch means a bug, not a request to honour
				if (call.projectId !== projectId) {
					throw new RpcError("FORBIDDEN", "Request belongs to another project");
				}
				if (!registry.get(call.group, call.variant)) {
					throw new RpcError(
						"NOT_FOUND",
						`Integration variant "${call.group}/${call.variant}" is not installed on this ${env} worker`,
					);
				}
				const config = projectConfig(projectId);
				if (!config) {
					throw new RpcError("NOT_FOUND", `This ${env} worker has no config for the project yet`);
				}
				try {
					return await runIntegrationHook(
						registry,
						op,
						call,
						(keys) => appConfigFromArtifact(config, keys),
						call.timeoutMs,
					);
				} catch (error) {
					// the message only: a stack stays on this worker
					throw new RpcError(
						"VALIDATION_FAILED",
						error instanceof Error ? error.message : String(error),
					);
				}
			},
			{ queue: INTEGRATION_OPS_QUEUE },
		),
	);
	return { stop: async () => void (await Promise.all(responders.map((r) => r.stop()))) };
}

/**
 * The referenced keys' values from the project config this worker's environment
 * was published, which already holds that environment's values. A key with none
 * fails the way the admin's lookup does.
 */
export function appConfigFromArtifact(config: ProjectConfigPayload, keys: string[]) {
	const missing = new Set(config.missingValues?.appConfig ?? []);
	const configMap = new Map<string, string>();
	for (const key of keys) {
		if (missing.has(key))
			throw new IntegrationOpError(`${missingAppConfigMessage(key)}. ${SET_ONE}`);
		const value = config.appConfig[key];
		if (value !== undefined) configMap.set(key, String(value));
	}
	return configMap;
}
