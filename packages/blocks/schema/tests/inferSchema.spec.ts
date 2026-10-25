import { describe, expect, test } from "bun:test";
import { inferSchema } from "../inferSchema";
import { ValidationSchemaZod } from "../validationSchemaZod";

describe("inferSchema", () => {
	test("object of primitives, int vs float, all required", () => {
		const s = inferSchema({ id: 1, price: 1.5, name: "a", ok: true });
		expect(s.dataType).toBe("object");
		expect(s.properties?.map((p) => [p.key, p.dataType, p.required])).toEqual([
			["id", "int", true],
			["price", "float", true],
			["name", "str", true],
			["ok", "bool", true],
		]);
	});

	test("array items merge: partial keys optional, int+float is float", () => {
		const s = inferSchema([
			{ a: 1, b: "x" },
			{ a: 2.5 },
			{ a: 3, b: null },
		]);
		expect(s.dataType).toBe("arr");
		const props = s.items?.properties;
		expect(props?.find((p) => p.key === "a")).toMatchObject({ dataType: "float", required: true });
		expect(props?.find((p) => p.key === "b")).toMatchObject({ dataType: "str", required: false });
	});

	test("mixed types become a union chain", () => {
		const s = inferSchema([1, "a"]);
		expect(s.items?.dataType).toBe("int");
		expect(s.items?.chain?.[0]).toMatchObject({
			chainType: "or",
			properties: [{ key: "str", dataType: "str" }],
		});
	});

	test("empty array, null and nesting", () => {
		expect(inferSchema([])).toEqual({ dataType: "arr" });
		expect(inferSchema(null)).toEqual({ dataType: "str" });
		const nested = inferSchema({ user: { tags: ["a"] } });
		expect(nested.properties?.[0]?.properties?.[0]?.items?.dataType).toBe("str");
	});

	test("output always passes the schema editor's own validator", () => {
		const sample = { a: [{ b: [1, "x", { c: null }] }, { d: 1.5 }], e: {} };
		expect(ValidationSchemaZod.safeParse(inferSchema(sample)).success).toBe(true);
	});
});
