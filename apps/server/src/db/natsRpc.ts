import {
	MAX_PAYLOAD_BYTES,
	RPC_TIMEOUT_MS,
	RpcError,
	rpcRequest as rpcRequestOn,
	rpcRespond as rpcRespondOn,
	type RpcErrorCode,
	type RpcResponse,
} from "@fluxify/common/nats";
import { natsConnection } from "./nats";

/**
 * Request/response over NATS for internal service-to-service calls (the AI
 * harness today, an MCP server later). HTTP stays the interface for the
 * frontend; this bus is never exposed.
 *
 * The envelope, codec and size limits live in `@fluxify/common/nats`. What is
 * app-specific — who the caller is, and which subjects exist — lives here.
 *
 * The bus is internal-only, so `caller` is trusted for *identity*. Access scope
 * is still enforced per query from `projectIds`, exactly as the HTTP
 * repositories do — identity is trusted, authorization is not skipped.
 */
export type RpcCaller = { userId: string; projectIds: string[] };

/**
 * One responder per subject. Payload shapes are defined by each operation's
 * own module; this file only owns the envelope around them.
 */
export const RPC_SUBJECTS = {
	route: "fluxify.ops.route",
	customBlock: "fluxify.ops.custom_block",
	workflow: "fluxify.ops.workflow",
	canvas: "fluxify.ops.canvas",
} as const;

export { MAX_PAYLOAD_BYTES, RPC_TIMEOUT_MS, RpcError };
export type { RpcErrorCode, RpcResponse };

/** Call a responder and get its payload back, or throw a typed `RpcError`. */
export function rpcRequest<TReq, TRes>(
	subject: string,
	caller: RpcCaller,
	payload: TReq,
	timeoutMs = RPC_TIMEOUT_MS,
): Promise<TRes> {
	return rpcRequestOn<TReq, TRes, RpcCaller>(
		natsConnection(),
		subject,
		payload,
		{ meta: caller, timeoutMs },
	);
}

/**
 * Register a responder. Queue-subscribed so replicas share the load instead of
 * all answering. Returns an async stop.
 */
export function rpcRespond<TReq, TRes>(
	subject: string,
	handler: (payload: TReq, caller: RpcCaller) => Promise<TRes>,
	queue = "fluxify.ops",
) {
	const responder = rpcRespondOn<TReq, TRes, RpcCaller>(
		natsConnection(),
		subject,
		handler,
		{ queue },
	);
	return responder.stop;
}
