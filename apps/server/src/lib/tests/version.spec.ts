import { describe, expect, it } from "bun:test";
import { releaseVersion, UNKNOWN_VERSION } from "../version";

describe("releaseVersion", () => {
	it.each([
		[undefined, UNKNOWN_VERSION],
		["", UNKNOWN_VERSION],
		["   ", UNKNOWN_VERSION],
		["dev", UNKNOWN_VERSION],
		["v2026.11.0", "v2026.11.0"],
		[" nightly-20261113 ", "nightly-20261113"],
	])("%p -> %p", (value, expected) => {
		expect(releaseVersion({ FLUXIFY_VERSION: value })).toBe(expected);
	});
});
