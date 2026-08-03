import { z } from "zod";
import { db } from "../../db";
import { RPC_SUBJECTS, rpcRespond, type RpcCaller } from "../../db/natsRpc";
import {
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	publishMessage,
} from "../../db/redis";
import { canAccessProject } from "../../lib/acl";
import { ForbiddenError } from "../../errors/forbidError";
import createCustomBlock from "../../api/v1/custom-blocks/create/service";
import updateCustomBlock from "../../api/v1/custom-blocks/update/service";
import deleteCustomBlock from "../../api/v1/custom-blocks/delete/service";
import { requestBodySchema as createSchema } from "../../api/v1/custom-blocks/create/dto";
import { requestBodySchema as modifySchema } from "../../api/v1/custom-blocks/update/dto";
import { saveCanvas } from "../canvas/service";
import { canvasChangesSchema } from "../canvas/types";
import { callerAcl, callerUser, toRpcError, validationFailed } from "./caller";

/** `fluxify.ops.custom_block` — same shape as the route subject, same rules. */
const requestSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		data: createSchema,
		canvas: canvasChangesSchema.nullish(),
	}),
	z.object({
		action: z.literal("modify"),
		id: z.string(),
		data: modifySchema,
	}),
	z.object({ action: z.literal("delete"), id: z.string() }),
]);

export type CustomBlockOpsRequest = z.input<typeof requestSchema>;

export async function handleCustomBlockOp(payload: unknown, caller: RpcCaller) {
	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success) throw validationFailed(parsed.error.issues);

	const op = parsed.data;
	const acl = callerAcl(caller);
	const user = callerUser(caller);
	try {
		if (op.action === "delete") return await deleteCustomBlock(op.id, user, acl);
		if (op.action === "modify")
			return await updateCustomBlock(op.id, op.data, user, acl);

		// the HTTP endpoint gets this from middleware; the bus has to do it itself
		if (!canAccessProject(acl, op.data.projectId, "creator"))
			throw new ForbiddenError();

		const result = await db.transaction(async (tx) => {
			const created = await createCustomBlock(op.data, tx);
			if (op.canvas)
				await saveCanvas(
					{ type: "custom_block", id: created.id },
					op.canvas,
					caller.projectIds,
					tx,
				);
			return created;
		});
		await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, result.id);
		return result;
	} catch (error) {
		throw toRpcError(error);
	}
}

export function registerCustomBlockResponder() {
	return rpcRespond(RPC_SUBJECTS.customBlock, handleCustomBlockOp);
}
