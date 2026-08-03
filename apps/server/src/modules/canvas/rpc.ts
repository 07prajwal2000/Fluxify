import { z } from "zod";
import { RPC_SUBJECTS, rpcRespond, type RpcCaller } from "../../db/natsRpc";
import { toRpcError, validationFailed } from "../ops/caller";
import { getCanvas, saveCanvas } from "./service";
import { canvasChangesSchema, canvasParentTypeSchema } from "./types";

/**
 * `fluxify.ops.canvas` — one way to change a canvas, whatever it belongs to.
 * A thin adapter: validate, map the domain error to a wire code, delegate.
 * All persistence lives in the canvas service, shared with the HTTP endpoints.
 */
const requestSchema = z.object({
	source: canvasParentTypeSchema,
	sourceId: z.string(),
	/** omit to read the canvas back instead of writing it */
	actionsToPerform: canvasChangesSchema.shape.actionsToPerform.nullish(),
	changes: canvasChangesSchema.shape.changes.nullish(),
});

export type CanvasOpsRequest = z.input<typeof requestSchema>;

export async function handleCanvasOp(payload: unknown, caller: RpcCaller) {
	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success) throw validationFailed(parsed.error.issues);

	const { source, sourceId, actionsToPerform, changes } = parsed.data;
	const parent = { type: source, id: sourceId };
	try {
		if (!actionsToPerform && !changes)
			return await getCanvas(parent, caller.projectIds);

		await saveCanvas(
			parent,
			{
				actionsToPerform: actionsToPerform ?? { blocks: [], edges: [] },
				changes: changes ?? { blocks: [], edges: [] },
			},
			caller.projectIds,
		);
		return null;
	} catch (error) {
		throw toRpcError(error);
	}
}

export function registerCanvasResponder() {
	return rpcRespond(RPC_SUBJECTS.canvas, handleCanvasOp);
}
