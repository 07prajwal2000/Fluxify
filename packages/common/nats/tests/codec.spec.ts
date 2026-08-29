import { describe, expect, it } from "bun:test";
import { decodeText, encodeText, gzipJsonCodec, jsonCodec } from "../codec";

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
