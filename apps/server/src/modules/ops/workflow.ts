import { z } from "zod";
import { db } from "../../db";
import { RPC_SUBJECTS, rpcRespond, type RpcCaller } from "../../db/natsRpc";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../db/redis";
import { createSchema, patchSchema } from "../../api/v1/workflows/dto";
import {
	createWorkflow,
	deleteWorkflow,
	updateWorkflow,
} from "../../api/v1/workflows/service";
import { saveCanvas } from "../canvas/service";
import { canvasChangesSchema } from "../canvas/types";
import { callerAcl, toRpcError, validationFailed } from "./caller";

/**
 * `fluxify.ops.workflow` — a transport for the workflow services, not a second
 * implementation. Same arrangement as `ops/route.ts`: the DTOs are the HTTP
 * ones, so validation cannot drift between REST and the bus.
 */
const requestSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		data: createSchema,
		/** optional, create only — lets the caller keep an id it already handed to
		 *  other outputs (a canvas naming its workflow) */
		id: z.uuidv7().nullish(),
		/** optional, create only — written in the same transaction */
		canvas: canvasChangesSchema.nullish(),
	}),
	z.object({ action: z.literal("modify"), id: z.string(), data: patchSchema }),
	z.object({ action: z.literal("delete"), id: z.string() }),
]);

export type WorkflowOpsRequest = z.input<typeof requestSchema>;

export async function handleWorkflowOp(payload: unknown, caller: RpcCaller) {
	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success) throw validationFailed(parsed.error.issues);

	const op = parsed.data;
	const acl = callerAcl(caller);
	try {
		if (op.action === "delete") return await deleteWorkflow(op.id, acl);
		if (op.action === "modify") return await updateWorkflow(op.id, op.data, acl);

		const hasCanvasBlocks = (op.canvas?.changes.blocks.length ?? 0) > 0;
		const result = await db.transaction(async (tx) => {
			const created = await createWorkflow(
				caller.userId,
				op.data,
				acl,
				tx,
				op.id ?? undefined,
				!hasCanvasBlocks,
			);
			if (op.canvas)
				await saveCanvas(
					{ type: "workflow", id: created.id },
					op.canvas,
					caller.projectIds,
					tx,
					true,
				);
			return created;
		});
		// published here, not by the service: it was told to join a transaction,
		// so only this scope knows whether it committed.
		await publishMessage(CHAN_ON_WORKFLOW_CHANGE, result.id);
		return result;
	} catch (error) {
		throw toRpcError(error);
	}
}

export function registerWorkflowResponder() {
	return rpcRespond(RPC_SUBJECTS.workflow, handleWorkflowOp);
}
