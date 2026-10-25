import { describe, expect, it } from "bun:test";
import { buildBlockInputTypeLib } from "./blockInputTypes";
import { FLUXIFY_JS_GLOBALS } from "./globals";

describe("buildBlockInputTypeLib", () => {
	it("merges the type into the interface the globals declare", () => {
		expect(buildBlockInputTypeLib("{ id: number }")).toBe(
			"declare interface FluxifyBlockInput { value: { id: number } }\n",
		);
		expect(FLUXIFY_JS_GLOBALS).toContain("interface FluxifyBlockInput");
	});

	it("declares nothing when the type is unknown, so input stays any", () => {
		expect(buildBlockInputTypeLib(undefined)).toBe("");
		expect(buildBlockInputTypeLib("any")).toBe("");
		expect(buildBlockInputTypeLib("  ")).toBe("");
	});
});
