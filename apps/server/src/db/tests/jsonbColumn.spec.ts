import { describe, expect, it } from "bun:test";
import { pgTable } from "drizzle-orm/pg-core";
import { jsonb } from "../jsonbColumn";

const probe = pgTable("jsonb_probe", { value: jsonb("value") });

describe("jsonb column", () => {
	it("hands the value to the driver untouched instead of stringifying it", () => {
		const value = { a: 1, nested: { b: "x" } };

		// drizzle's built-in jsonb() returns JSON.stringify(value) here, which the
		// bun-sql driver then serializes again — storing a jsonb *string*.
		expect(probe.value.mapToDriverValue(value)).toEqual(value);
	});

	it("still declares a jsonb column", () => {
		expect(probe.value.getSQLType()).toBe("jsonb");
	});
});
