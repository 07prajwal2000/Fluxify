import {
	type IntegrationOp,
	type IntegrationOpCall,
	IntegrationOpError,
	integrationRegistry,
	runIntegrationHook,
} from "@fluxify/adapters/integrations";
import { RpcError, rpcRequest } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import { type FluxifyEnv, INTEGRATION_WORKER_TIMEOUT_MS } from "../../lib/env";
import { decodeAppConfig } from "./appConfig";
import {
	type IntegrationOpPayload,
	type IntegrationOpRequest,
	integrationOpSubject,
} from "./types";

/** a hook's own budget, wherever it runs */
export const INTEGRATION_OP_TIMEOUT_MS = 10_000;

export type IntegrationOpMode = "local" | "worker";

/** One op on one integration config, in the environment whose values it reads. */
export type IntegrationOpTarget = IntegrationOpCall & {
	projectId: string;
	env: FluxifyEnv;
	integrationId?: string;
};

/**
 * Where an op runs (decision 8): a built-in in this process, anything else on a
 * worker of the target's environment. `force` sends a built-in to a worker too
 * (the container tests). MCP always stays here: its OAuth tokens live in this
 * database and never travel.
 */
export function integrationOpMode(
	group: string,
	variant: string,
	force?: IntegrationOpMode,
): IntegrationOpMode {
	if (group === "mcp") return "local";
	if (force) return force;
	return integrationRegistry.isBuiltIn(group, variant) ? "local" : "worker";
}

/**
 * Test connection, metadata (`describe`) and inspect, for every variant. The
 * result is the hook's; a failure throws with a message meant for the caller.
 */
export async function runIntegrationOp(
	op: IntegrationOp,
	target: IntegrationOpTarget,
	options: { timeoutMs?: number; mode?: IntegrationOpMode } = {},
): Promise<unknown> {
	const timeoutMs = options.timeoutMs ?? INTEGRATION_OP_TIMEOUT_MS;
	if (integrationOpMode(target.group, target.variant, options.mode) === "worker") {
		return runOnWorker(op, target, timeoutMs);
	}
	return runIntegrationHook(
		integrationRegistry,
		op,
		target,
		(keys) => decodeAppConfig(keys, target.projectId, target.env),
		timeoutMs,
	);
}

async function runOnWorker(op: IntegrationOp, target: IntegrationOpTarget, timeoutMs: number) {
	const payload: IntegrationOpPayload = {
		projectId: target.projectId,
		integrationId: target.integrationId,
		group: target.group,
		variant: target.variant,
		config: target.config,
		request: target.request,
		// only what survives JSON: a function or a client never crosses
		options: JSON.parse(JSON.stringify(target.options ?? {})),
		timeoutMs,
	};
	const env = target.env;
	try {
		return await rpcRequest<IntegrationOpRequest, unknown>(
			natsConnection(),
			natsName(integrationOpSubject(op, target.projectId), env),
			{ sealed: EncryptionService.encrypt(JSON.stringify(payload)) },
			{ meta: undefined, timeoutMs: INTEGRATION_WORKER_TIMEOUT_MS },
		);
	} catch (error) {
		if (!(error instanceof RpcError)) throw error;
		if (error.code === "NO_RESPONDERS") {
			throw new IntegrationOpError(
				`No ${env} worker is running for this project. Start one with FLUXIFY_ENV=${env}, then try again.`,
			);
		}
		if (error.code === "TIMEOUT") {
			throw new IntegrationOpError(
				`No response from a ${env} worker in ${INTEGRATION_WORKER_TIMEOUT_MS / 1000}s`,
			);
		}
		// the worker's own message: what failed, never a stack
		throw new IntegrationOpError(error.message);
	}
}
