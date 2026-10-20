import { describe, it, expect } from "bun:test";
import { INSTANCE_SETTINGS_REGISTRY, pluginsSchema, resolveIsPublic } from "../schemas";

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

describe("plugins setting (trusted domains)", () => {
	const parse = (trustedDomains: unknown) => pluginsSchema.safeParse({ trustedDomains });

	it("defaults to no trusted domain, which turns the URL source off", () => {
		expect(pluginsSchema.parse({}).trustedDomains).toEqual([]);
	});
	it("accepts hostnames and *. subdomain entries", () => {
		expect(parse(["plugins.acme.dev", "*.acme.dev"]).success).toBe(true);
	});
	it.each([
		["a URL", "https://acme.dev"],
		["a path", "acme.dev/plugins"],
		["a bare wildcard", "*"],
		["a wildcard inside a name", "a.*.dev"],
		["uppercase", "Acme.dev"],
		["a port", "acme.dev:8443"],
	])("refuses %s", (_, entry) => {
		expect(parse([entry]).success).toBe(false);
	});
	it("is registered for the plugins category and is not public", () => {
		expect(INSTANCE_SETTINGS_REGISTRY.plugins.category).toBe("plugins");
		expect(INSTANCE_SETTINGS_REGISTRY.plugins.alwaysPublic).toBe(false);
	});
});
