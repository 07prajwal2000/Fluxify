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

/**
 * One responder per subject. Payload shapes are defined by each operation's
 * own module; this file only owns the envelope around them.
 */
export const RPC_SUBJECTS = {
	route: "fluxify.ops.route",
	customBlock: "fluxify.ops.custom_block",
	canvas: "fluxify.ops.canvas",
} as const;

export type RpcErrorCode =
	| "VALIDATION_FAILED"
	| "NOT_FOUND"
	| "PARENT_NOT_FOUND"
	| "CONFLICT"
	| "FORBIDDEN"
	| "TIMEOUT"
	| "PAYLOAD_TOO_LARGE"
	| "INTERNAL";

export type RpcResponse<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			error: { code: RpcErrorCode; message: string; details?: unknown };
	  };

// Canvas payloads are the bulky ones. Measured round trip (encode+decode) on a
// synthetic canvas, 200 iterations:
//
//   blocks/edges   JSON          JSON+gzip
//   50/80          0.29ms  49KiB  0.37ms   2KiB
//   250/400        1.22ms 245KiB  1.87ms   7KiB
//   1000/1600      5.45ms 985KiB  8.05ms  29KiB
//
// Time is irrelevant next to the DB transaction on the other end; *size* is
// not — plain JSON reaches NATS's 1MiB `max_payload` at around a thousand
// blocks and the request is then dropped by the server, not by us. So: JSON,
// gzipped once it gets big. (The bench data is repetitive, so the real ratio
// will be worse than 33x — but even 5x moves the ceiling out of reach.)
//
// Small messages stay literally plain JSON on the wire, so `nats sub` is still
// readable when something is stuck. Gzip's magic bytes tell the two apart, so
// no framing byte is needed.
const codec = JSONCodec<unknown>();
const COMPRESS_ABOVE_BYTES = 32 * 1024;
/** NATS server default is 1MiB; leave headroom for subject and headers. */
export const MAX_PAYLOAD_BYTES = 1_000_000;

// nats types its buffers as Uint8Array<ArrayBufferLike>, Bun's zlib wants
// Uint8Array<ArrayBuffer>. Same bytes; the cast is the whole difference.
const bytes = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

function encode(value: unknown): Uint8Array {
	const raw = codec.encode(value);
	return raw.length > COMPRESS_ABOVE_BYTES ? Bun.gzipSync(bytes(raw)) : raw;
}

function decode<T>(data: Uint8Array): T {
	const gzipped = data[0] === 0x1f && data[1] === 0x8b;
	return codec.decode(gzipped ? Bun.gunzipSync(bytes(data)) : data) as T;
}

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
	const body = encode(request);

	// The server drops an oversized message and the caller just sees a timeout.
	// Fail here instead, where we can say what actually happened.
	if (body.length > MAX_PAYLOAD_BYTES)
		throw new RpcError(
			"PAYLOAD_TOO_LARGE",
			`Request to ${subject} is ${body.length} bytes, over the ${MAX_PAYLOAD_BYTES} limit — split it into smaller batches`,
			{ requestId, bytes: body.length },
		);

	let message;
	try {
		message = await natsConnection().request(subject, body, {
			timeout: timeoutMs,
		});
	} catch (error) {
		throw new RpcError(
			"TIMEOUT",
			`No response from ${subject} within ${timeoutMs}ms`,
			{ requestId, error: String(error) },
		);
	}

	const response = decode<RpcResponse<TRes>>(message.data);
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
				const request = decode<RpcRequest<TReq>>(message.data);
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
			// Same reasoning as the request side: an oversized reply is dropped
			// by the server and the caller sees a bare timeout. Send an error
			// that fits instead — a huge canvas read is the realistic case.
			let body = encode(response);
			if (body.length > MAX_PAYLOAD_BYTES) {
				logger.error(
					`[RPC] ${subject} response too large (${requestId}): ${body.length} bytes`,
				);
				body = encode({
					ok: false,
					error: {
						code: "PAYLOAD_TOO_LARGE",
						message: `Response is ${body.length} bytes, over the ${MAX_PAYLOAD_BYTES} limit — request a narrower slice`,
					},
				} satisfies RpcResponse<never>);
			}
			message.respond(body);
		}
	})();
	return async () => {
		await sub.drain();
	};
}
