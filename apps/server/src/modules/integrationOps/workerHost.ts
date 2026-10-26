import {
	appConfigKeys,
	INTEGRATION_OPS,
	type IntegrationOp,
	IntegrationOpError,
	type IntegrationRegistry,
	integrationRegistry,
	runIntegrationHook,
} from "@fluxify/adapters/integrations";
import { RpcError, type RpcResponder, rpcRespond, subscribe } from "@fluxify/common/nats";
import { SET_ONE } from "../../api/v1/integrations/adminEnv";
import { natsConnection, natsName } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import { missingAppConfigMessage } from "../../lib/envValues";
import type { ProjectConfigPayload } from "../compiler/artifacts";
import type { PluginIntegrationRef } from "../requestRouter/pluginIntegrations";
import { runOpInChild } from "./isolated";
import {
	INTEGRATION_OPS_QUEUE,
	type IntegrationOpPayload,
	type IntegrationOpRequest,
	integrationOpCancelSubject,
	integrationOpSubject,
} from "./types";

/** how long a cancel waits for its op before the entry is dropped */
const CANCEL_KEEP_MS = 60_000;

/**
 * The worker half of an integration op (I3): one project's Test connection,
 * metadata and inspect, run through this worker's registry against its own
 * environment's app config. `projectConfig` is the project's published config
 * as this worker holds it.
 *
 * A built-in's hook runs here. A plugin variant's never does: this process
 * holds MASTER_ENCRYPTION_KEY, so its hook runs in a fresh child (I6,
 * `runOpInChild`) that gets the stored config and only the app config values
 * it references.
 */
export function serveIntegrationOps(
	projectId: string,
	env: FluxifyEnv,
	projectConfig: (projectId: string) => ProjectConfigPayload | undefined,
	{
		registry = integrationRegistry,
		pluginRefs = () => [],
		runIsolated = runOpInChild,
	}: {
		registry?: IntegrationRegistry;
		/** where this node's plugin integration variants are */
		pluginRefs?: () => PluginIntegrationRef[];
		runIsolated?: typeof runOpInChild;
	} = {},
): RpcResponder {
	// a cancel can beat its op (the responder takes requests one at a time), so either side may create the entry
	const running = new Map<string, AbortController>();
	const controllerFor = (opId: string) => {
		const controller = running.get(opId) ?? new AbortController();
		running.set(opId, controller);
		return controller;
	};
	const canceller = subscribe(
		natsConnection(),
		natsName(integrationOpCancelSubject(projectId), env),
		(opId) => {
			controllerFor(opId).abort();
			// an op that never reaches this worker would leave the entry behind
			setTimeout(() => running.delete(opId), CANCEL_KEEP_MS).unref();
		},
	);
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
				const ref = registry.isBuiltIn(call.group, call.variant)
					? undefined
					: pluginRefs().find(
							(r) =>
								r.projectId === projectId && r.group === call.group && r.variant === call.variant,
						);
				if (!ref && !registry.get(call.group, call.variant, projectId)) {
					throw new RpcError(
						"NOT_FOUND",
						`Integration variant "${call.group}/${call.variant}" is not installed on this ${env} worker`,
					);
				}
				const config = projectConfig(projectId);
				if (!config) {
					throw new RpcError("NOT_FOUND", `This ${env} worker has no config for the project yet`);
				}
				const signal = call.opId ? controllerFor(call.opId).signal : undefined;
				try {
					if (ref) return await runPluginOp(op, call, ref, config, runIsolated, signal);
					return await runIntegrationHook(
						registry,
						op,
						{ ...call, projectId },
						(keys) => appConfigFromArtifact(config, keys),
						call.timeoutMs,
						signal,
					);
				} catch (error) {
					// the message only: a stack stays on this worker
					throw new RpcError(
						"VALIDATION_FAILED",
						error instanceof Error ? error.message : String(error),
					);
				} finally {
					if (call.opId) running.delete(call.opId);
				}
			},
			{ queue: INTEGRATION_OPS_QUEUE },
		),
	);
	return {
		stop: async () =>
			void (await Promise.all([canceller.stop(), ...responders.map((r) => r.stop())])),
	};
}

/** a plugin variant's op in its own child, with only the values its config references */
function runPluginOp(
	op: IntegrationOp,
	call: IntegrationOpPayload,
	ref: PluginIntegrationRef,
	config: ProjectConfigPayload,
	runIsolated: typeof runOpInChild,
	signal?: AbortSignal,
) {
	const appConfig = appConfigFromArtifact(config, appConfigKeys(call.config));
	const { timeoutMs, integrationId: _, projectId: __, opId: ___, ...rest } = call;
	return runIsolated(
		{ ref, op, call: rest, appConfig: [...appConfig], timeoutMs },
		undefined,
		signal,
	);
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
