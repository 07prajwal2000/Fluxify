import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { entitlement, GRACE_PERIOD_DAYS, NON_COMMERCIAL, resolveLicense } from "../index";

// Throwaway issuer. The build's real public key never appears in a test.
const issuer = generateKeyPairSync("ed25519");
const publicKey = issuer.publicKey.export({ type: "spki", format: "pem" }).toString();
const DAY = 86_400_000;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
	claims: Record<string, unknown>,
	{ key = issuer.privateKey, alg = "EdDSA" }: { key?: KeyObject; alg?: string } = {},
) {
	const body = `${b64({ alg, typ: "JWT" })}.${b64(claims)}`;
	return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
}

describe("resolveLicense", () => {
	it("unset or blank is community", () => {
		expect(resolveLicense(undefined, publicKey)).toEqual({ kind: "community" });
		expect(resolveLicense("  ", publicKey)).toEqual({ kind: "community" });
	});

	it("NON_COMMERCIAL grants enterprise features", () => {
		const license = resolveLicense(NON_COMMERCIAL, publicKey);
		expect(license).toEqual({ kind: "non_commercial" });
		expect(entitlement(license)).toMatchObject({ canRun: true, canCreate: true });
	});

	it("verifies a signed key", () => {
		const exp = Math.floor(Date.now() / 1000) + 3600;
		expect(resolveLicense(token({ sub: "acme", exp }), publicKey)).toEqual({
			kind: "signed",
			licensee: "acme",
			expiresAt: new Date(exp * 1000).toISOString(),
		});
	});

	it("resolves every bad key to community without throwing", () => {
		const good = token({ sub: "acme" });
		const [h, , s] = good.split(".");
		const bad = [
			"garbage",
			"a.b.c",
			`${good}.extra`,
			`${h}.${b64({ sub: "evil-corp" })}.${s}`, // tampered payload
			token({ sub: "acme" }, { key: generateKeyPairSync("ed25519").privateKey }), // wrong issuer
			token({ sub: "acme" }, { alg: "none" }),
			token({ exp: 9_999_999_999 }), // no licensee
			token({ sub: "acme", exp: "never" }),
		];
		for (const key of bad) expect(resolveLicense(key, publicKey)).toEqual({ kind: "community" });
	});

	it("a build with no public key treats every signed key as community", () => {
		expect(resolveLicense(token({ sub: "acme" }), null)).toEqual({ kind: "community" });
	});
});

describe("entitlement", () => {
	const signed = (expiresAt: number | null) =>
		({
			kind: "signed",
			licensee: "acme",
			expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
		}) as const;
	const now = Date.parse("2026-09-10T00:00:00Z");

	it("community gets nothing", () => {
		expect(entitlement({ kind: "community" })).toMatchObject({
			status: "community",
			canRun: false,
			canCreate: false,
		});
	});

	it("an unexpired or perpetual key is active", () => {
		expect(entitlement(signed(now + DAY), now).status).toBe("active");
		expect(entitlement(signed(null), now).status).toBe("active");
	});

	it("expired keeps running work, refuses new connections, and counts down", () => {
		expect(entitlement(signed(now - 2 * DAY), now)).toEqual({
			status: "expired",
			canRun: true,
			canCreate: false,
			graceEndsAt: new Date(now + (GRACE_PERIOD_DAYS - 2) * DAY).toISOString(),
			daysRemaining: GRACE_PERIOD_DAYS - 2,
		});
	});

	it("stops enterprise features after the grace period, still reporting expired", () => {
		expect(entitlement(signed(now - (GRACE_PERIOD_DAYS + 1) * DAY), now)).toMatchObject({
			status: "expired",
			canRun: false,
			canCreate: false,
			daysRemaining: 0,
		});
	});
});
