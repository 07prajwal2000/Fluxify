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
