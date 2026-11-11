// #760: OLAP_BACKEND=clickhouse is honoured only on enterprise (with the feature) or non-commercial.
import { describe, expect, it } from "bun:test";
import { entitlement } from "@fluxify/common/license";
import { canUseOlap } from "../../../lib/edition";

const day = 24 * 60 * 60_000;
const signed = (features: string[], expiresInDays: number | null) => ({
	kind: "signed" as const,
	licensee: "acme",
	expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * day).toISOString(),
	features,
});

describe("canUseOlap", () => {
	it.each([
		["community", { kind: "community" as const }, false],
		["non-commercial", { kind: "non_commercial" as const }, true],
		["enterprise with olap", signed(["olap"], 30), true],
		["enterprise with all features", signed(["*"], null), true],
		["enterprise without olap", signed(["sso"], 30), false],
		["expired, in grace", signed(["olap"], -5), true],
		["expired, past grace", signed(["olap"], -400), false],
	])("%s", (_, license, expected) => {
		expect(canUseOlap(entitlement(license))).toBe(expected);
	});
});
