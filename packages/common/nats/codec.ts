import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * v3 removed `StringCodec` and `JSONCodec`. Payloads are now `Uint8Array | string`
 * on the way out and raw bytes on the way back, so every module needs the same
 * two functions. They live here once rather than as a `const sc = StringCodec()`
 * at the top of nine files, and the interface is what a msgpack or protobuf
 * codec would implement later without touching a call site.
 */
export interface Codec<T = unknown> {
	encode(value: T): Uint8Array;
	decode(data: Uint8Array): T;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeText(value: string): Uint8Array {
	return encoder.encode(value);
}

export function decodeText(data: Uint8Array): string {
	return decoder.decode(data);
}

/** UTF-8 JSON. The default for anything that is not enormous. */
export function jsonCodec<T = unknown>(): Codec<T> {
	return {
		encode: (value) => encodeText(JSON.stringify(value)),
		decode: (data) => JSON.parse(decodeText(data)) as T,
	};
}

/** gzip's magic bytes, which is how the decoder tells the two framings apart. */
function isGzipped(data: Uint8Array): boolean {
	return data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * JSON, gzipped once it gets big. NATS drops a message over the server's
 * `max_payload` (1MiB by default) rather than erroring usefully, and a large
 * canvas reaches that on plain JSON. Below the threshold the bytes stay literal
 * JSON so `nats sub` is still readable when something is stuck; no framing byte
 * is needed because gzip announces itself.
 */
export function gzipJsonCodec<T = unknown>(thresholdBytes = 32 * 1024): Codec<T> {
	const json = jsonCodec<T>();
	return {
		encode(value) {
			const raw = json.encode(value);
			return raw.length > thresholdBytes ? gzipSync(raw) : raw;
		},
		decode(data) {
			return json.decode(isGzipped(data) ? gunzipSync(data) : data);
		},
	};
}

/**
 * MessagePack. Chosen over protobuf because there is no schema to compile and
 * no generated code to drift from the TypeScript types.
 *
 * It buys size, not speed. Measured on a 500-item batch of records with
 * repeated keys — the shape a batched trigger actually carries:
 *
 *   size    json 54171B   msgpack 36399B   (33% smaller)
 *   encode  json 0.090ms  msgpack 0.288ms
 *   decode  json 0.236ms  msgpack 0.366ms
 *
 * JSON is *faster*, because both directions run in the engine's native C++
 * while this is a JavaScript parse loop. So reach for msgpack when bytes are
 * the constraint — the 1MiB `max_payload` ceiling, stream storage, cross-AZ
 * egress — and leave JSON in place when CPU is. Binary values also survive
 * without a base64 round trip, which is worth roughly a third again on any
 * payload carrying them.
 *
 * The other cost is that the wire stops being readable: `nats sub` shows bytes,
 * not a payload. Between that and the numbers above, JSON stays the default.
 *
 * A codec is not something a live stream can change its mind about — messages
 * published under one are still in flight when the switch happens, and the
 * consumer decodes them with the other. Use this for new subjects, or migrate
 * a stream while it is drained.
 */
export function msgpackCodec<T = unknown>(): Codec<T> {
	return {
		encode: (value) => msgpackEncode(value),
		decode: (data) => msgpackDecode(data) as T,
	};
}

/**
 * MessagePack, gzipped once it gets big — the same ceiling problem as
 * `gzipJsonCodec`, on a body that is already smaller. msgpack has no magic
 * bytes of its own, so gzip's are still what tells the two framings apart:
 * 0x1f is `int 31` in msgpack and would only ever appear as the first byte of a
 * bare integer payload, which is not a shape anything here publishes.
 */
export function gzipMsgpackCodec<T = unknown>(
	thresholdBytes = 32 * 1024,
): Codec<T> {
	const pack = msgpackCodec<T>();
	return {
		encode(value) {
			const raw = pack.encode(value);
			return raw.length > thresholdBytes ? gzipSync(raw) : raw;
		},
		decode(data) {
			return pack.decode(isGzipped(data) ? gunzipSync(data) : data);
		},
	};
}
