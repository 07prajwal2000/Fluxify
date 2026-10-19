import { describe, expect, it } from "bun:test";
import { cachedZod, compileSchema, SCHEMA_CACHE_MAX } from "../schemaCache";

const def = (key: string) => ({
	dataType: "object",
	properties: [{ key, dataType: "str", required: true }],
});

describe("schema cache", () => {
	it("shares one zod for an identical definition", () => {
		const a = compileSchema(def("sc_same"));
		const b = compileSchema(def("sc_same"));
		expect(a.zod).toBe(b.zod);
		expect(a.schema).toEqual(def("sc_same"));
	});

	it("ignores object key order", () => {
		const a = { dataType: "str", rules: [{ type: "minLength", value: 2 }] };
		const b = { rules: [{ value: 2, type: "minLength" }], dataType: "str" };
		expect(compileSchema(a).zod).toBe(compileSchema(b).zod);
	});

	it("keeps coerce and strict builds apart", () => {
		const d = { dataType: "int" };
		expect(cachedZod(d, true)).not.toBe(cachedZod(d, false));
		expect(cachedZod(d, true)?.safeParse("5").success).toBe(true);
	});

	it("parses with the compiled zod", () => {
		const { zod } = compileSchema(def("name"));
		expect(zod.safeParse({ name: "a" }).success).toBe(true);
		expect(zod.safeParse({}).success).toBe(false);
	});

	it("rejects an invalid definition, and does not cache it", () => {
		expect(() => compileSchema({ dataType: "nope" })).toThrow("Invalid schema definition");
		expect(cachedZod({ dataType: "nope" })).toBeUndefined();
	});

	it("evicts the least recently used schema at the cap", () => {
		const first = compileSchema(def("lru_first")).zod;
		const second = compileSchema(def("lru_second")).zod;
		for (let i = 0; i < SCHEMA_CACHE_MAX - 2; i++) compileSchema(def(`lru_fill_${i}`));
		// touch `first` so `second` is now the oldest, then overflow by one
		expect(compileSchema(def("lru_first")).zod).toBe(first);
		compileSchema(def("lru_overflow"));
		expect(compileSchema(def("lru_first")).zod).toBe(first);
		expect(compileSchema(def("lru_second")).zod).not.toBe(second);
	});
});
