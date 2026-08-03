import { z } from "zod";
import {
	RPC_SUBJECTS,
	RpcError,
	rpcRespond,
	type RpcCaller,
} from "../../db/natsRpc";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { NotFoundError } from "../../errors/notFoundError";
import { ValidationError } from "../../errors/validationError";
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

/**
 * Domain errors are the service's contract; wire codes are this transport's.
 * Anything unmapped stays an exception and `rpcRespond` reports it INTERNAL —
 * an unrecognised failure should look like a bug, not a client mistake.
 */
function toRpcError(error: unknown): unknown {
	if (error instanceof NotFoundError)
		return new RpcError("PARENT_NOT_FOUND", error.message);
	if (error instanceof ConflictError)
		return new RpcError("CONFLICT", error.message);
	if (error instanceof ValidationError)
		return new RpcError("VALIDATION_FAILED", error.message, error.errors);
	if (error instanceof BadRequestError)
		return new RpcError("VALIDATION_FAILED", error.message);
	return error;
}

export async function handleCanvasOp(payload: unknown, caller: RpcCaller) {
	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success)
		throw new RpcError(
			"VALIDATION_FAILED",
			"Malformed canvas operation",
			parsed.error.issues.map((i) => ({
				field: i.path.join("."),
				message: i.message,
			})),
		);

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
