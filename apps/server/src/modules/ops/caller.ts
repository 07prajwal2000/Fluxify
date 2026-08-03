import type { User } from "better-auth";
import { RpcError, type RpcCaller } from "../../db/natsRpc";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { ValidationError } from "../../errors/validationError";
import type { AuthACL } from "../../db/schema";

/**
 * The bus is internal, so the envelope's `caller` is trusted for identity —
 * authorization already happened at the edge that produced it. `projectIds` is
 * the scope that survived that check, so it maps to creator-level ACL entries
 * and the existing services enforce it exactly as they do for HTTP.
 */
export function callerAcl(caller: RpcCaller): AuthACL[] {
	return caller.projectIds.map((projectId) => ({
		projectId,
		role: "creator" as const,
	}));
}

/** the services that take a better-auth user only ever read `isSystemAdmin` */
export function callerUser(caller: RpcCaller) {
	return { id: caller.userId, isSystemAdmin: false } as User & {
		isSystemAdmin: boolean;
	};
}

/**
 * Domain errors are the services' contract; wire codes are this transport's.
 * Anything unmapped stays an exception and `rpcRespond` reports it INTERNAL —
 * an unrecognised failure should look like a bug, not a client mistake.
 */
export function toRpcError(error: unknown): unknown {
	if (error instanceof NotFoundError)
		return new RpcError("PARENT_NOT_FOUND", error.message);
	if (error instanceof ConflictError)
		return new RpcError("CONFLICT", error.message);
	if (error instanceof ForbiddenError)
		return new RpcError("FORBIDDEN", error.message);
	if (error instanceof ValidationError)
		return new RpcError("VALIDATION_FAILED", error.message, error.errors);
	if (error instanceof BadRequestError)
		return new RpcError("VALIDATION_FAILED", error.message);
	return error;
}

/** a zod failure in the shape the wire contract expects */
export function validationFailed(issues: { path: PropertyKey[]; message: string }[]) {
	return new RpcError(
		"VALIDATION_FAILED",
		"Malformed operation",
		issues.map((i) => ({ field: i.path.join("."), message: i.message })),
	);
}
