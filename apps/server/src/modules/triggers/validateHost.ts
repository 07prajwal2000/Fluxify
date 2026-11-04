import { RpcError, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import type { ExecutionSupervisor } from "../requestRouter/executionSupervisor";
import type { PluginTriggerRef } from "../requestRouter/pluginTriggers";

/**
 * A plugin trigger's `validate` for one project (#985), answered by a worker
 * serving it. Namespaced per environment with `natsName`; the admin only ever
 * asks development.
 *
 * Never under `fluxify.triggers.`: the FLUXIFY_TRIGGERS stream captures
 * `fluxify.triggers.>`, so JetStream would answer the request with a publish
 * ack (read as "Malformed response") and keep the payload as work.
 */
export const triggerValidateSubject = (projectId: string) =>
	`fluxify.trigger-validate.${projectId}`;

/** one worker answers each request */
export const TRIGGER_VALIDATE_QUEUE = "fluxify_trigger_validate";

/** sealed with MASTER_ENCRYPTION_KEY: `source` is what the user typed */
export type TriggerValidatePayload = {
	projectId: string;
	kind: string;
	/** the approved plugin archive's hash: the code installed here must be it */
	integrity: string;
	source: Record<string, unknown>;
};

export type TriggerValidateRequest = { sealed: string };

/**
 * The worker half: hands the settings to the execution process, the only
 * place plugin code runs, and answers with its warnings. A kind not installed
 * here (or installed at another version) is NOT_FOUND; the author's error is
 * VALIDATION_FAILED, its message only.
 */
export function serveTriggerValidation(
	projectId: string,
	env: FluxifyEnv,
	supervisor: Pick<ExecutionSupervisor, "validateTrigger">,
	triggerRefs: () => PluginTriggerRef[],
): RpcResponder {
	return rpcRespond<TriggerValidateRequest, string[]>(
		natsConnection(),
		natsName(triggerValidateSubject(projectId), env),
		async ({ sealed }) => {
			const call: TriggerValidatePayload = JSON.parse(EncryptionService.decrypt(sealed));
			// the subject already scopes it; a mismatch means a bug, not a request to honour
			if (call.projectId !== projectId)
				throw new RpcError("FORBIDDEN", "Request belongs to another project");
			const ref = triggerRefs().find((r) => r.projectId === projectId && r.kind === call.kind);
			if (!ref || ref.integrity !== call.integrity)
				throw new RpcError(
					"NOT_FOUND",
					`The approved version of trigger ${call.kind} is not installed on this ${env} worker yet`,
				);
			try {
				return await supervisor.validateTrigger({
					projectId,
					kind: call.kind,
					source: call.source,
				});
			} catch (error) {
				throw new RpcError(
					"VALIDATION_FAILED",
					error instanceof Error ? error.message : String(error),
				);
			}
		},
		{ queue: TRIGGER_VALIDATE_QUEUE },
	);
}
