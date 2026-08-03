import {
	RPC_SUBJECTS,
	RpcError,
	rpcRequest,
	type RpcCaller,
} from "@fluxify/server/src/db/natsRpc";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "@fluxify/server";
import type { CanvasChanges, CanvasItems } from "./normalize";

/**
 * The harness writes artifacts through the internal req/res bus, not by
 * touching the tables. `@fluxify/server` owns route, custom block and canvas
 * persistence; this app only asks for it.
 *
 * The HTTP endpoint above stays the authorization edge — it authenticates the
 * request and hands the result down as `caller`. Nothing here invents identity.
 */
export function callerFor(userId: string, projectId: string): RpcCaller {
	return { userId, projectIds: [projectId] };
}

/**
 * Wire codes back into the HTTP errors this app already reports. `PARENT_NOT_FOUND`
 * and `VALIDATION_FAILED` are things the user (or a follow-up run) can act on;
 * `INTERNAL` and `TIMEOUT` are failures, so they stay 500s.
 */
export function fromRpcError(error: unknown) {
	if (!(error instanceof RpcError)) return error;
	switch (error.code) {
		case "PARENT_NOT_FOUND":
		case "NOT_FOUND":
			return new NotFoundError(error.message);
		case "VALIDATION_FAILED":
		case "PAYLOAD_TOO_LARGE":
			return new BadRequestError(error.message);
		case "CONFLICT":
			return new ConflictError(error.message);
		case "FORBIDDEN":
			return new ForbiddenError(error.message);
		default:
			return error;
	}
}

async function call<T>(subject: string, caller: RpcCaller, payload: unknown) {
	try {
		return await rpcRequest<unknown, T>(subject, caller, payload);
	} catch (error) {
		throw fromRpcError(error);
	}
}

/** Create a route, optionally with its whole canvas in the same transaction so
 *  an approved plan cannot half-apply. Returns the id storage actually chose. */
export function createRoute(
	caller: RpcCaller,
	data: Record<string, unknown>,
	canvas?: CanvasChanges,
) {
	return call<{ id: string }>(RPC_SUBJECTS.route, caller, {
		action: "create",
		data,
		canvas,
	});
}

export function modifyRoute(
	caller: RpcCaller,
	id: string,
	data: Record<string, unknown>,
) {
	return call<{ id: string }>(RPC_SUBJECTS.route, caller, {
		action: "modify",
		id,
		data,
	});
}

export function deleteRoute(caller: RpcCaller, id: string) {
	return call<{ id: string }>(RPC_SUBJECTS.route, caller, { action: "delete", id });
}

/** Omitting both change fields is a read — that is how the subject is defined. */
export function readCanvas(
	caller: RpcCaller,
	source: "route" | "custom_block",
	sourceId: string,
) {
	return call<CanvasItems>(RPC_SUBJECTS.canvas, caller, { source, sourceId });
}

export function saveCanvas(
	caller: RpcCaller,
	source: "route" | "custom_block",
	sourceId: string,
	changes: CanvasChanges,
) {
	return call<null>(RPC_SUBJECTS.canvas, caller, { source, sourceId, ...changes });
}
