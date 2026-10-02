import { describe, expect, it } from "bun:test";
import { encodePayload } from "./base";
import { streamFields } from "./redisStreamsProducer";

describe("payload encoding", () => {
	it("sends text as-is and everything else as JSON", () => {
		expect(encodePayload("hello")).toBe("hello");
		expect(encodePayload(42)).toBe("42");
		expect(encodePayload(true)).toBe("true");
		expect(encodePayload(null)).toBe("null");
		expect(encodePayload({ id: 7, tags: ["a"] })).toBe('{"id":7,"tags":["a"]}');
	});

	it("sends a BigInt as its digits in a string", () => {
		expect(encodePayload(9007199254740993n)).toBe('"9007199254740993"');
		expect(encodePayload({ id: 9007199254740993n })).toBe('{"id":"9007199254740993"}');
	});

	it("refuses what JSON cannot carry", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => encodePayload(undefined)).toThrow();
		expect(() => encodePayload(() => 1)).toThrow();
		expect(() => encodePayload({ run: () => 1 })).toThrow("function");
		expect(() => encodePayload(Symbol("s"))).toThrow();
		expect(() => encodePayload(cyclic)).toThrow();
	});

	it("turns an object into stream fields and anything else into one data field", () => {
		expect(streamFields({ id: 7, name: "ada", meta: { a: 1 } })).toEqual([
			"id",
			"7",
			"name",
			"ada",
			"meta",
			'{"a":1}',
		]);
		expect(streamFields("hello")).toEqual(["data", "hello"]);
		expect(streamFields([1, 2])).toEqual(["data", "[1,2]"]);
	});
});
