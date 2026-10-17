import { describe, expect, it } from "bun:test";
import { entitlement, GRACE_PERIOD_DAYS, type License } from "@fluxify/common/license";
import { auditLogsDefaultEnabled, canRecordAudit } from "../../../lib/edition";

const DAY = 86_400_000;
const now = Date.parse("2026-10-17T00:00:00Z");
const signed = (features: string[], expiresInDays: number): License => ({
	kind: "signed",
	licensee: "Acme",
	expiresAt: new Date(now + expiresInDays * DAY).toISOString(),
	features,
});
const gate = (license: License, at = now) => {
	const e = entitlement(license, at);
	return { record: canRecordAudit(e), byDefault: auditLogsDefaultEnabled(e) };
};

describe("audit logs entitlement", () => {
	it("is off for community", () => {
		expect(gate({ kind: "community" })).toEqual({ record: false, byDefault: false });
	});

	it("is on for the non-commercial tier", () => {
		expect(gate({ kind: "non_commercial" })).toEqual({ record: true, byDefault: true });
	});

	it("is on for a signed key that lists auditLogs, or everything", () => {
		expect(gate(signed(["auditLogs"], 30)).record).toBe(true);
		expect(gate(signed(["*"], 30)).record).toBe(true);
	});

	it("is off for a signed key without the feature", () => {
		expect(gate(signed(["connectors", "sso"], 30))).toEqual({ record: false, byDefault: false });
	});

	it("keeps recording through the grace period, but new projects start off", () => {
		const lapsed = signed(["auditLogs"], 0);
		const inGrace = now + (GRACE_PERIOD_DAYS - 1) * DAY;
		expect(gate(lapsed, inGrace)).toEqual({ record: true, byDefault: false });
	});

	it("stops recording once the grace period ends", () => {
		const lapsed = signed(["auditLogs"], 0);
		expect(gate(lapsed, now + (GRACE_PERIOD_DAYS + 1) * DAY).record).toBe(false);
	});
});
