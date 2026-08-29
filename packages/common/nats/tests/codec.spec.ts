import { describe, expect, it } from "bun:test";
import {
	decodeText,
	encodeText,
	gzipJsonCodec,
	gzipMsgpackCodec,
	jsonCodec,
	msgpackCodec,
} from "../codec";

describe("jsonCodec", () => {
	it("round-trips a value", () => {
		const codec = jsonCodec<{ a: number; b: string[] }>();
		const value = { a: 1, b: ["x", "y"] };
		expect(codec.decode(codec.encode(value))).toEqual(value);
	});

	it("stays readable on the wire", () => {
		// `nats sub` showing the payload is the whole reason small messages are
		// not compressed — if this stops being literal JSON, debugging gets worse
		expect(decodeText(jsonCodec().encode({ hello: "world" }))).toBe(
			'{"hello":"world"}',
		);
	});
});

describe("gzipJsonCodec", () => {
	it("leaves small payloads uncompressed", () => {
		const codec = gzipJsonCodec(1024);
		const encoded = codec.encode({ small: true });
		expect(encoded[0]).not.toBe(0x1f);
		expect(decodeText(encoded)).toBe('{"small":true}');
	});

	it("compresses past the threshold and round-trips", () => {
		const codec = gzipJsonCodec<{ blob: string }>(64);
		const value = { blob: "x".repeat(4096) };
		const encoded = codec.encode(value);
		expect(encoded[0]).toBe(0x1f);
		expect(encoded[1]).toBe(0x8b);
		expect(encoded.length).toBeLessThan(4096);
		expect(codec.decode(encoded)).toEqual(value);
	});

	it("decodes either framing, since the magic bytes are the only marker", () => {
		const codec = gzipJsonCodec(64);
		expect(codec.decode(encodeText('{"plain":1}'))).toEqual({ plain: 1 });
	});
});

describe("msgpackCodec", () => {
	it("round-trips the shapes this bus carries", () => {
		const codec = msgpackCodec<Record<string, unknown>>();
		const value = {
			id: "job-1",
			attempt: 3,
			enqueuedAt: "2026-08-29T00:00:00.000Z",
			nested: { rows: [1, 2, 3], ok: true, missing: null },
		};
		expect(codec.decode(codec.encode(value))).toEqual(value);
	});

	it("carries binary through without a base64 round trip", () => {
		const codec = msgpackCodec<{ blob: Uint8Array }>();
		const value = { blob: new Uint8Array([0, 1, 255, 128]) };
		expect(codec.decode(codec.encode(value)).blob).toEqual(value.blob);
	});

	it("is smaller than JSON on a repeated-key payload", () => {
		// the reason it is here at all: batches repeat the same keys per item
		const batch = Array.from({ length: 200 }, (_, i) => ({
			id: `evt-${i}`,
			receivedAt: 1_756_000_000_000 + i,
			data: { value: i, ok: true },
		}));
		expect(msgpackCodec().encode(batch).length).toBeLessThan(
			jsonCodec().encode(batch).length,
		);
	});
});

describe("gzipMsgpackCodec", () => {
	it("leaves small payloads bare", () => {
		const codec = gzipMsgpackCodec<{ n: number }>(1024);
		const encoded = codec.encode({ n: 1 });
		expect(encoded[0]).not.toBe(0x1f);
		expect(codec.decode(encoded)).toEqual({ n: 1 });
	});

	it("compresses past the threshold and round-trips", () => {
		const codec = gzipMsgpackCodec<{ blob: string }>(64);
		const value = { blob: "x".repeat(4096) };
		const encoded = codec.encode(value);
		expect(encoded[0]).toBe(0x1f);
		expect(encoded[1]).toBe(0x8b);
		expect(codec.decode(encoded)).toEqual(value);
	});

	it("does not mistake a msgpack body starting with 0x1f for gzip", () => {
		// 0x1f is positive fixint 31; only the two-byte gzip header means gzip
		const codec = gzipMsgpackCodec<number>(1024);
		const encoded = codec.encode(31);
		expect(encoded[0]).toBe(0x1f);
		expect(codec.decode(encoded)).toBe(31);
	});
});
