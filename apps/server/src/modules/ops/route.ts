import { z } from "zod";
import { db } from "../../db";
import { RPC_SUBJECTS, rpcRespond, type RpcCaller } from "../../db/natsRpc";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../db/redis";
import { canAccessProject } from "../../lib/acl";
import { ForbiddenError } from "../../errors/forbidError";
import createRoute from "../../api/v1/routes/create/service";
import updateRoute from "../../api/v1/routes/update-partial/service";
import deleteRoute from "../../api/v1/routes/delete/service";
import { requestBodySchema as createSchema } from "../../api/v1/routes/create/dto";
import { requestBodySchema as modifySchema } from "../../api/v1/routes/update-partial/dto";
import { saveCanvas } from "../canvas/service";
import { canvasChangesSchema } from "../canvas/types";
import { callerAcl, toRpcError, validationFailed } from "./caller";

/**
 * `fluxify.ops.route` — a transport for the existing route services, not a
 * second implementation. The DTOs are the HTTP ones, so validation rules
 * (including the non-empty `name` the routes list depends on) cannot drift.
 */
const requestSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		data: createSchema,
		/** optional, create only — lets the caller keep an id it already handed
		 *  to other outputs (a canvas naming its route) instead of learning a
		 *  new one after the fact */
		id: z.uuidv7().nullish(),
		/** optional, create only — written in the same transaction as the route */
		canvas: canvasChangesSchema.nullish(),
	}),
	z.object({
		action: z.literal("modify"),
		id: z.string(),
		data: modifySchema,
	}),
	z.object({ action: z.literal("delete"), id: z.string() }),
]);

export type RouteOpsRequest = z.input<typeof requestSchema>;

export async function handleRouteOp(payload: unknown, caller: RpcCaller) {
	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success) throw validationFailed(parsed.error.issues);

	const op = parsed.data;
	const acl = callerAcl(caller);
	try {
		if (op.action === "delete") {
			await deleteRoute(op.id, acl);
			return { id: op.id };
		}
		if (op.action === "modify") return await updateRoute(op.id, op.data, acl);

		// create: the HTTP route relies on middleware for this check, so the bus
		// has to make it itself before anything is written.
		if (!canAccessProject(acl, op.data.projectId, "creator"))
			throw new ForbiddenError();

		const hasCanvasBlocks = (op.canvas?.changes.blocks.length ?? 0) > 0;
		const result = await db.transaction(async (tx) => {
			const created = await createRoute(
				caller.userId,
				op.data,
				tx,
				op.id ?? undefined,
				!hasCanvasBlocks,
			);
			if (op.canvas)
				await saveCanvas(
					{ type: "route", id: created.id },
					op.canvas,
					caller.projectIds,
					tx,
					true,
				);
			return created;
		});
		// published here, not by the services: they were told to join a
		// transaction, so only this scope knows whether it committed.
		await publishMessage(CHAN_ON_ROUTE_CHANGE, result.id);
		return result;
	} catch (error) {
		throw toRpcError(error);
	}
}

export function registerRouteResponder() {
	return rpcRespond(RPC_SUBJECTS.route, handleRouteOp);
}
