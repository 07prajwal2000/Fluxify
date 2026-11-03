import { describe, expect, it } from "bun:test";
import { hint, isJsExpression, paramProblems, param } from "../blocks.js";

const problems = (params: Record<string, unknown>, values: Record<string, unknown> = {}) =>
	paramProblems(params as never, values);

describe("paramProblems", () => {
	it("is empty for a clean block and ignores hints and unknown keys", () => {
		expect(problems({ note: hint("hi"), a: param.string() }, { a: "x", stray: 1 })).toEqual({});
	});

	describe("required and defaults", () => {
		const params = { need: param.string({ required: true }), mode: param.string({ required: true, default: "a" }) };
		it("flags a missing, null or blank required param", () => {
			for (const value of [undefined, null, "", "   "])
				expect(problems(params, { need: value, mode: "x" })).toEqual({ need: "is required" });
		});
		it("counts an empty list or object as blank", () => {
			expect(problems({ l: param.array({ required: true }) }, { l: [] })).toEqual({ l: "is required" });
			expect(problems({ k: param.keyValue({ required: true }) }, { k: {} })).toEqual({ k: "is required" });
		});
		it("never misses a param that has a default", () => {
			expect(problems(params, { need: "x" })).toEqual({});
		});
		it("treats false and 0 as present", () => {
			expect(problems({ b: param.boolean({ required: true }) }, { b: false })).toEqual({});
			expect(problems({ n: param.number({ required: true }) }, { n: 0 })).toEqual({});
		});
		it("does not flag an empty optional param", () => {
			expect(problems({ a: param.string(), n: param.number() }, { a: "", n: undefined })).toEqual({});
		});
	});

	describe("types", () => {
		it("takes any value for a string param, as run gets it as text", () => {
			expect(problems({ a: param.string() }, { a: 5 })).toEqual({});
			expect(problems({ a: param.string() }, { a: { x: 1 } })).toEqual({});
		});
		it("flags a boolean, integration, appconfig and secret of the wrong type", () => {
			const params = {
				b: param.boolean(),
				i: param.integration({ kind: "kv" }),
				c: param.appconfig(),
				s: param.secret(),
			};
			expect(problems(params, { b: "yes", i: 1, c: true, s: {} })).toEqual({
				b: "must be a boolean, got string",
				i: "must be a string, got number",
				c: "must be a string, got boolean",
				s: "must be a string, got object",
			});
		});
		it("accepts cfg:KEY and a bare key for appconfig", () => {
			expect(problems({ c: param.appconfig() }, { c: "cfg:KEY" })).toEqual({});
			expect(problems({ c: param.appconfig() }, { c: "KEY" })).toEqual({});
		});
		it("flags a number given as text, and bounds", () => {
			const n = { n: param.number({ min: 1, max: 5, integer: true }) };
			expect(problems(n, { n: "abc" })).toEqual({ n: "must be a number, got string" });
			expect(problems(n, { n: "3" })).toEqual({ n: "must be a number, got string" });
			expect(problems(n, { n: 0 })).toEqual({ n: "must be at least 1, got 0" });
			expect(problems(n, { n: 6 })).toEqual({ n: "must be at most 5, got 6" });
			expect(problems(n, { n: 2.5 })).toEqual({ n: "must be an integer" });
			expect(problems(n, { n: 3 })).toEqual({});
		});
		it("holds a select to its options", () => {
			const s = { s: param.select({ options: ["a", "b"] }) };
			expect(problems(s, { s: "c" })).toEqual({ s: 'must be one of a, b, got "c"' });
			expect(problems(s, { s: "a" })).toEqual({});
		});
		it("wants conditions to be a list and a fieldMap an object", () => {
			expect(problems({ c: param.conditions() }, { c: {} })).toEqual({ c: "must be an array of conditions" });
			expect(problems({ c: param.conditions() }, { c: [] })).toEqual({});
			expect(problems({ f: param.fieldMap() }, { f: [] })).toEqual({ f: "must be an object" });
			expect(problems({ f: param.fieldMap() }, { f: { a: "b" } })).toEqual({});
		});
		it("takes a schema as its definition, not compiled", () => {
			expect(problems({ s: param.schema() }, { s: { type: "object" } })).toEqual({});
			expect(problems({ s: param.schema() }, { s: "nope" })).toEqual({ s: "must be a schema definition" });
			expect(problems({ s: param.schema() }, { s: null })).toEqual({});
		});
	});

	describe("collections", () => {
		it("holds an array between min and max, counting every item", () => {
			const a = { a: param.array({ min: 2, max: 3 }) };
			expect(problems(a, { a: ["x"] })).toEqual({ a: "needs at least 2 items, got 1" });
			expect(problems(a, { a: ["x", "js:1", 3, 4] })).toEqual({ a: "takes at most 3 items, got 4" });
			expect(problems(a, { a: ["x", "js:1"] })).toEqual({});
			expect(problems(a, { a: "x" })).toEqual({ a: "must be an array" });
		});
		it("refuses an empty or repeated key, but not a js: value", () => {
			const k = { k: param.keyValue() };
			expect(problems(k, { k: { " ": "a" } })).toEqual({ k: "has an empty key" });
			expect(problems(k, { k: { a: "1", " a ": "2" } })).toEqual({ k: "has the key 'a' twice" });
			expect(problems(k, { k: { a: "js: 1", b: 2 } })).toEqual({});
			expect(problems(k, { k: [] })).toEqual({ k: "must be an object of keys and values" });
		});
	});

	describe("js: values", () => {
		it("skips a value that is a js: expression, whatever the param", () => {
			const params = {
				n: param.number({ min: 1 }),
				s: param.select({ options: ["a"] }),
				a: param.array({ min: 2 }),
				b: param.boolean(),
				c: param.conditions(),
			};
			expect(problems(params, { n: "js: 0", s: "js: x", a: "js: []", b: "js:true", c: "js: []" })).toEqual({});
		});
		it("counts a js: value as present for required", () => {
			expect(problems({ a: param.string({ required: true }) }, { a: "js:x" })).toEqual({});
			expect(problems({ a: param.js({ required: true }) }, { a: "js:return 1" })).toEqual({});
			expect(problems({ a: param.js({ required: true }) }, {})).toEqual({ a: "is required" });
		});
		it("knows a js: expression", () => {
			expect(isJsExpression("js:1")).toBe(true);
			expect(isJsExpression(" js:1")).toBe(false);
			expect(isJsExpression(1)).toBe(false);
		});
	});

	describe("visibleWhen", () => {
		const params = {
			mode: param.select({ options: ["simple", "advanced"], default: "simple" }),
			level: param.string({ required: true, visibleWhen: { mode: "advanced" } }),
			size: param.number({ max: 2, visibleWhen: { mode: "advanced" } }),
		};
		it("skips a hidden param, using the default to decide", () => {
			expect(problems(params, { size: 9 })).toEqual({});
			expect(problems(params, { mode: "simple", size: 9 })).toEqual({});
		});
		it("checks it once shown", () => {
			expect(problems(params, { mode: "advanced", size: 9 })).toEqual({
				level: "is required",
				size: "must be at most 2, got 9",
			});
		});
	});
});

describe("paramProblems: string minLength and pattern", () => {
	const s = { s: param.string({ minLength: 3, pattern: "^[a-z0-9-]+$" }) };
	it("flags a short value and one that does not match", () => {
		expect(problems(s, { s: "ab" })).toEqual({ s: "must be at least 3 characters, got 2" });
		expect(problems(s, { s: "ABC" })).toEqual({ s: "must match ^[a-z0-9-]+$" });
		expect(problems(s, { s: "abc-1" })).toEqual({});
	});
	it("checks the text a number stored in the field reads as", () => {
		expect(problems({ s: param.string({ pattern: "^[0-9]+$" }) }, { s: 12345 })).toEqual({});
		expect(problems({ s: param.string({ minLength: 3 }) }, { s: 12 })).toEqual({
			s: "must be at least 3 characters, got 2",
		});
	});
	it("does not check an optional param left empty, nor a js: value", () => {
		for (const value of [undefined, null, "", "   "]) expect(problems(s, { s: value })).toEqual({});
		expect(problems(s, { s: "js: 'x'" })).toEqual({});
	});
	it("leaves an empty required param to required, and a hidden one alone", () => {
		expect(problems({ s: param.string({ required: true, minLength: 3 }) }, { s: "" })).toEqual({
			s: "is required",
		});
		const hidden = { m: param.select({ options: ["a", "b"], default: "a" }), s: param.string({ minLength: 3, visibleWhen: { m: "b" } }) };
		expect(problems(hidden, { s: "x" })).toEqual({});
	});
	it("checks no pattern a manifest of another source got wrong, rather than failing the save", () => {
		expect(problems({ s: { type: "string", pattern: "(" } }, { s: "x" })).toEqual({});
	});
	it("does not touch secret and appconfig params", () => {
		const p = { a: { type: "appconfig", minLength: 9, pattern: "^z" }, k: { type: "secret", minLength: 9 } };
		expect(problems(p, { a: "cfg:K", k: "cfg:K" })).toEqual({});
	});
});
