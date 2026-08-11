import { describe, it, expect } from "bun:test";
import { resolveIsPublic } from "../schemas";

describe("resolveIsPublic", () => {
	it("forces sso_config public even when the caller explicitly sends false", () => {
		expect(resolveIsPublic("sso_config", false, false)).toBe(true);
	});

	it("forces auth_config public when nothing is passed at all", () => {
		expect(resolveIsPublic("auth_config", undefined, undefined)).toBe(true);
	});

	it("leaves a non-registry key at the normal default (false)", () => {
		expect(resolveIsPublic("some_other_key", undefined, undefined)).toBe(false);
	});

	it("still respects the caller/stored isPublic for a non-forced key", () => {
		expect(resolveIsPublic("some_other_key", undefined, true)).toBe(true);
		expect(resolveIsPublic("some_other_key", true, undefined)).toBe(true);
		expect(resolveIsPublic("some_other_key", false, true)).toBe(false);
	});
});
