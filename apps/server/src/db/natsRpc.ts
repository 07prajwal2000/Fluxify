import { logger } from "@fluxify/common";
import { JSONCodec } from "nats";
import { generateID } from "@fluxify/lib";
import { natsConnection } from "./nats";

/**
 * Request/response over NATS for internal service-to-service calls (the AI
 * harness today, an MCP server later). HTTP stays the interface for the
 * frontend; this bus is never exposed.
 *
 * The bus is internal-only, so `caller` is trusted for *identity*. Access scope
 * is still enforced per query from `projectIds`, exactly as the HTTP
 * repositories do — identity is trusted, authorization is not skipped.
 */
export type RpcCaller = { userId: string; projectIds: string[] };

export type RpcRequest<T> = {
	caller: RpcCaller;
	requestId: string;
	payload: T;
};

export type RpcErrorCode =
	| "VALIDATION_FAILED"
	| "NOT_FOUND"
	| "PARENT_NOT_FOUND"
	| "CONFLICT"
	| "FORBIDDEN"
	| "TIMEOUT"
	| "INTERNAL";

export type RpcResponse<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			error: { code: RpcErrorCode; message: string; details?: unknown };
	  };

// Canvas payloads are the bulky ones. JSON is what the whole stack already
// speaks and what makes a stuck request readable in `nats sub`; swap the codec
// here (one place) if a measured round trip ever says otherwise.
const codec = JSONCodec<unknown>();

/** default request deadline; a canvas apply is a transaction, not a lookup */
export const RPC_TIMEOUT_MS = 15_000;

export class RpcError extends Error {
	constructor(
		readonly code: RpcErrorCode,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "RpcError";
	}
}

/** Call a responder and get its payload back, or throw a typed `RpcError`. */
export async function rpcRequest<TReq, TRes>(
	subject: string,
	caller: RpcCaller,
	payload: TReq,
	timeoutMs = RPC_TIMEOUT_MS,
): Promise<TRes> {
	const requestId = generateID();
	const request: RpcRequest<TReq> = { caller, requestId, payload };

	let message;
	try {
		message = await natsConnection().request(subject, codec.encode(request), {
			timeout: timeoutMs,
		});
	} catch (error) {
		throw new RpcError(
			"TIMEOUT",
			`No response from ${subject} within ${timeoutMs}ms`,
			{ requestId, error: String(error) },
		);
	}

	const response = codec.decode(message.data) as RpcResponse<TRes>;
	if (!response?.ok) {
		const err = response?.error;
		throw new RpcError(
			err?.code ?? "INTERNAL",
			err?.message ?? "Malformed response",
			err?.details,
		);
	}
	return response.data;
}

/**
 * Register a responder. It never throws across the wire: an unexpected error
 * becomes `ok:false` + `INTERNAL`, logged server-side with the request id.
 * Queue-subscribed so replicas share the load instead of all answering.
 */
export function rpcRespond<TReq, TRes>(
	subject: string,
	handler: (payload: TReq, caller: RpcCaller) => Promise<TRes>,
	queue = "fluxify.ops",
) {
	const sub = natsConnection().subscribe(subject, { queue });
	(async () => {
		for await (const message of sub) {
			let requestId = "unknown";
			let response: RpcResponse<TRes>;
			try {
				const request = codec.decode(message.data) as RpcRequest<TReq>;
				requestId = request?.requestId ?? "unknown";
				response = {
					ok: true,
					data: await handler(request.payload, request.caller),
				};
			} catch (error) {
				const rpc =
					error instanceof RpcError
						? error
						: new RpcError(
								"INTERNAL",
								error instanceof Error ? error.message : String(error),
							);
				if (rpc.code === "INTERNAL") {
					logger.error(`[RPC] ${subject} failed (${requestId})`, { error });
				}
				response = {
					ok: false,
					error: {
						code: rpc.code,
						message: rpc.message,
						details: rpc.details,
					},
				};
			}
			message.respond(codec.encode(response));
		}
	})();
	return async () => {
		await sub.drain();
	};
}
