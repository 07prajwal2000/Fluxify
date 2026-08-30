import { describe, expect, it } from "bun:test";
import { buildInputDataTypeLib } from "./inputDataTypes";

describe("buildInputDataTypeLib", () => {
	it("merges into the interface the globals declare", () => {
		const lib = buildInputDataTypeLib({
			dataType: "object",
			properties: [{ key: "customerId", dataType: "str", required: true }],
		});

		expect(lib).toContain("declare interface FluxifyInputData");
		expect(lib).toContain("customerId: string;");
	});

	it("marks an optional field optional", () => {
		const lib = buildInputDataTypeLib({
			dataType: "object",
			properties: [{ key: "note", dataType: "str" }],
		});

		expect(lib).toContain("note?: string;");
	});

	it("types nested objects, arrays and enums", () => {
		const lib = buildInputDataTypeLib({
			dataType: "object",
			properties: [
				{
					key: "attachment",
					dataType: "object",
					required: true,
					properties: [{ key: "data", dataType: "str", required: true }],
				},
				{
					key: "tags",
					dataType: "arr",
					required: true,
					items: { key: "item", dataType: "str" },
				},
				{
					key: "encoding",
					dataType: "enum",
					required: true,
					rules: [{ type: "values", value: ["base64", "hex"] }],
				},
			],
		});

		expect(lib).toContain("data: string;");
		expect(lib).toContain("tags: string[];");
		expect(lib).toContain('encoding: "base64" | "hex";');
	});

	it("quotes a key that is not an identifier", () => {
		const lib = buildInputDataTypeLib({
			dataType: "object",
			properties: [{ key: "content-type", dataType: "str", required: true }],
		});

		expect(lib).toContain('"content-type": string;');
	});

	it("declares nothing when the schema describes nothing", () => {
		// an empty interface would take away the free-form access the globals'
		// index signature allows
		expect(buildInputDataTypeLib(null)).toBe("");
		expect(buildInputDataTypeLib({ dataType: "object", properties: [] })).toBe("");
		expect(buildInputDataTypeLib({ dataType: "str" })).toBe("");
	});
});
