import { z } from "zod";
import { RPC_SUBJECTS, rpcRespond } from "../../db/natsRpc";
import { disableTrigger } from "../../api/v1/triggers/service";
import { validationFailed } from "./caller";

/**
 * `fluxify.ops.trigger_fault` — a worker saying a queue trigger's source is
 * gone. Workers hold no database, so disabling it is this process's job.
 */
const faultSchema = z.object({
	triggerId: z.string().min(1),
	projectId: z.string().min(1),
	reason: z.string().max(2_000),
});

export function registerTriggerFaultResponder() {
	return rpcRespond(RPC_SUBJECTS.triggerFault, async (payload: unknown) => {
		const parsed = faultSchema.safeParse(payload);
		if (!parsed.success) throw validationFailed(parsed.error.issues);
		const { triggerId, projectId, reason } = parsed.data;
		await disableTrigger(triggerId, projectId, reason);
		return { ok: true };
	});
}
