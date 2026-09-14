import { describe, expect, it } from "bun:test";
import { buildCanvasVariableTypeLib } from "./canvasVariableTypes";

describe("buildCanvasVariableTypeLib", () => {
	it("declares each variable with the snippet's description as JSDoc", () => {
		expect(
			buildCanvasVariableTypeLib([
				{ name: "res", source: "Get Weather" },
				{ name: "res", source: "Fallback" },
				"total",
			]),
		).toBe(
			'/** Read context variable "res" set by "Get Weather", "Fallback" */\ndeclare var res: any;\n\n' +
				'/** Read context variable "total" from execution state */\ndeclare var total: any;\n',
		);
	});

	it("follows a block rename", () => {
		expect(buildCanvasVariableTypeLib([{ name: "res", source: "Renamed" }])).toContain('set by "Renamed"');
	});

	it("skips names that are not identifiers and escapes comment ends", () => {
		const lib = buildCanvasVariableTypeLib([
			{ name: "my var" },
			{ name: "ok", source: "evil */ declare" },
		]);
		expect(lib).not.toContain("my var");
		expect(lib).toContain('"evil *\\/ declare"');
		expect(lib).toContain("declare var ok: any;");
	});

	it("is empty when there are no variables", () => {
		expect(buildCanvasVariableTypeLib([])).toBe("");
	});
});
