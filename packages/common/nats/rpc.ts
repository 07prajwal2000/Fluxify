import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { type Codec, gzipJsonCodec } from "./codec";

/**
 * Request/response over core NATS, for internal service-to-service calls. HTTP
 * stays the interface for anything outside the cluster; this bus is never
 * exposed.
 *
 * The envelope carries a caller-defined `meta` (identity, tenancy, a trace id)
 * alongside the payload. The bus being internal makes that meta trustworthy for
 * *identity*; it does not make authorization someone else's problem, and every
 * responder is still expected to scope its own queries.
 */

export type RpcErrorCode =
	| "VALIDATION_FAILED"
	| "NOT_FOUND"
	| "PARENT_NOT_FOUND"
	| "CONFLICT"
	| "FORBIDDEN"
	| "TIMEOUT"
	| "PAYLOAD_TOO_LARGE"
	| "INTERNAL";

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

export interface RpcRequest<TPayload, TMeta> {
	meta: TMeta;
	requestId: string;
	payload: TPayload;
}

export type RpcResponse<T> =
	| { ok: true; data: T }
	| { ok: false; error: { code: RpcErrorCode; message: string; details?: unknown } };

/** The NATS server default is 1MiB; leave headroom for subject and headers. */
export const MAX_PAYLOAD_BYTES = 1_000_000;
/** A request that carries a database transaction deserves more than a lookup. */
export const RPC_TIMEOUT_MS = 15_000;

/**
 * Compressed JSON by default. An oversized message is dropped by the *server*,
 * so an uncompressed large payload shows up as a bare timeout with nothing in
 * any log; gzip moves that ceiling far enough out to stop being a concern.
 */
const defaultCodec = gzipJsonCodec<unknown>();

export interface RpcRequestOptions<TMeta> {
	meta: TMeta;
	timeoutMs?: number;
	codec?: Codec<unknown>;
	maxPayloadBytes?: number;
}

/** Calls a responder and returns its payload, or throws a typed `RpcError`. */
export async function rpcRequest<TReq, TRes, TMeta = undefined>(
	nc: NatsConnection,
	subject: string,
	payload: TReq,
	options: RpcRequestOptions<TMeta>,
): Promise<TRes> {
	const codec = options.codec ?? defaultCodec;
	const maxBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
	const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
	const requestId = crypto.randomUUID();

	const body = codec.encode({
		meta: options.meta,
		requestId,
		payload,
	} satisfies RpcRequest<TReq, TMeta>);

	// Fail here, where we can say what actually happened, rather than let the
	// server drop it and leave the caller staring at a timeout.
	if (body.length > maxBytes) {
		throw new RpcError(
			"PAYLOAD_TOO_LARGE",
			`Request to ${subject} is ${body.length} bytes, over the ${maxBytes} limit — split it into smaller batches`,
			{ requestId, bytes: body.length },
		);
	}

	let message;
	try {
		message = await nc.request(subject, body, { timeout: timeoutMs });
	} catch (error) {
		throw new RpcError("TIMEOUT", `No response from ${subject} within ${timeoutMs}ms`, {
			requestId,
			error: String(error),
		});
	}

	const response = codec.decode(message.data) as RpcResponse<TRes> | undefined;
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

export interface RpcResponderOptions {
	/** Queue group, so replicas share the load instead of all answering. */
	queue?: string;
	codec?: Codec<unknown>;
	maxPayloadBytes?: number;
}

export interface RpcResponder {
	/** Stops answering, draining anything in flight. */
	stop(): Promise<void>;
}

/**
 * Registers a responder. It never throws across the wire: an unexpected error
 * becomes `ok:false` + `INTERNAL`, logged locally with the request id.
 */
export function rpcRespond<TReq, TRes, TMeta = undefined>(
	nc: NatsConnection,
	subject: string,
	handler: (payload: TReq, meta: TMeta) => Promise<TRes>,
	options: RpcResponderOptions = {},
): RpcResponder {
	const codec = options.codec ?? defaultCodec;
	const maxBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
	const sub = nc.subscribe(subject, options.queue ? { queue: options.queue } : {});

	void (async () => {
		for await (const message of sub) {
			let requestId = "unknown";
			let response: RpcResponse<TRes>;
			try {
				const request = codec.decode(message.data) as RpcRequest<TReq, TMeta>;
				requestId = request?.requestId ?? "unknown";
				response = { ok: true, data: await handler(request.payload, request.meta) };
			} catch (error) {
				const rpc =
					error instanceof RpcError
						? error
						: new RpcError(
								"INTERNAL",
								error instanceof Error ? error.message : String(error),
							);
				if (rpc.code === "INTERNAL") {
					logger.error(`[nats] rpc ${subject} failed (${requestId})`, "NATS", { error });
				}
				response = {
					ok: false,
					error: { code: rpc.code, message: rpc.message, details: rpc.details },
				};
			}

			// Same reasoning as the request side: an oversized reply is dropped by
			// the server and the caller sees a bare timeout. Send an error that
			// fits instead.
			let body = codec.encode(response);
			if (body.length > maxBytes) {
				logger.error(
					`[nats] rpc ${subject} response too large (${requestId}): ${body.length} bytes`,
					"NATS",
				);
				body = codec.encode({
					ok: false,
					error: {
						code: "PAYLOAD_TOO_LARGE",
						message: `Response is ${body.length} bytes, over the ${maxBytes} limit — request a narrower slice`,
					},
				} satisfies RpcResponse<never>);
			}
			message.respond(body);
		}
	})();

	return {
		stop: async () => {
			await sub.drain();
		},
	};
}
