import { RpcError, rpcRequest } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import { BadRequestError } from "../../errors/badRequestError";
import { EncryptionService } from "../../lib/encryption";
import { INTEGRATION_WORKER_TIMEOUT_MS } from "../../lib/env";
import {
	type TriggerValidatePayload,
	type TriggerValidateRequest,
	triggerValidateSubject,
} from "./validateHost";

/** saved anyway: no development worker means nothing can run the plugin's code */
export const NO_DEV_WORKER_WARNING =
	"No development worker is running for this project: skipped the trigger's validation";

/**
 * The admin half (#985): asks a development worker to run a plugin trigger's
 * `validate` on the settings being saved. Plugin code never runs here. Its
 * warnings come back; its error refuses the save as a 400. With no worker to
 * ask, or none with the approved version installed yet, the save goes ahead
 * with a warning.
 */
export async function runTriggerValidation(payload: TriggerValidatePayload): Promise<string[]> {
	try {
		return await rpcRequest<TriggerValidateRequest, string[]>(
			natsConnection(),
			natsName(triggerValidateSubject(payload.projectId), "development"),
			{ sealed: EncryptionService.encrypt(JSON.stringify(payload)) },
			{ meta: undefined, timeoutMs: INTEGRATION_WORKER_TIMEOUT_MS },
		);
	} catch (error) {
		if (!(error instanceof RpcError)) throw error;
		if (error.code === "NO_RESPONDERS") return [NO_DEV_WORKER_WARNING];
		if (error.code === "NOT_FOUND") return [`${error.message}: skipped the trigger's validation`];
		if (error.code === "TIMEOUT")
			throw new BadRequestError(
				`No response from a development worker in ${INTEGRATION_WORKER_TIMEOUT_MS / 1000}s`,
			);
		// the author's own message: what is wrong with the settings, never a stack
		throw new BadRequestError(error.message);
	}
}
