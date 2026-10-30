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

describe("sse global (#1024)", () => {
	it("is a declare const, so the editor's global scan picks it up", () => {
		expect(FLUXIFY_JS_GLOBALS).toMatch(/declare const sse: \{/);
	});

	it("declares the runtime's methods with hover docs on the handle and auth", () => {
		for (const member of [
			"connect(id: string): string;",
			"readonly connectionId: string | undefined;",
			"send(handle: string, data: unknown, options?: { event?: string; eventId?: string }): Promise<boolean>;",
			"close(handle: string): Promise<void>;",
			"signal(handle: string): AbortSignal;",
		])
			expect(FLUXIFY_JS_GLOBALS).toContain(member);
		expect(FLUXIFY_JS_GLOBALS).toContain('"<integrationId>:<id>"');
		expect(FLUXIFY_JS_GLOBALS).toContain("Check auth before calling it");
	});
});
