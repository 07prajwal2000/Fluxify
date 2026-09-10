import { createPublicKey, verify } from "node:crypto";
import { logger } from "../logging";

/**
 * Edition and license resolution. Offline only — nothing here phones home.
 *
 * `resolveLicense` turns `LICENSE_KEY` into a `License`: what the key proved,
 * and nothing about the current time. `entitlement` reads that against a clock.
 * The split is what lets expiry and the grace period take effect on a running
 * process: the license is published once at boot, the clock keeps moving.
 *
 * Every failure resolves to community and logs. A bad key must never crash a
 * boot, and must never be mistaken for a paid one.
 */

/** Grants enterprise features without a signed key. The default until a stable release. */
export const NON_COMMERCIAL = "NON_COMMERCIAL";

/**
 * How long enterprise features keep running after a license expires.
 * Placeholder, not confirmed — this is the one definition, change it here.
 */
export const GRACE_PERIOD_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * The issuer's Ed25519 public key, SPKI PEM. Baked into the build and never
 * read from the environment: a key an operator could set is a key anyone could
 * self-sign against.
 */
// ponytail: no issuer exists yet, so every signed key resolves to community. Paste its public key here when it does.
const LICENSE_PUBLIC_KEY: string | null = null;

/** What a key proved. The only license value that crosses processes. */
export type License =
	| { kind: "community" }
	| { kind: "non_commercial" }
	| { kind: "signed"; licensee: string; expiresAt: string | null };

export type LicenseStatus = "community" | "non_commercial" | "active" | "expired";

export interface Entitlement {
	status: LicenseStatus;
	/** Enterprise features that already exist keep working. */
	canRun: boolean;
	/** New enterprise connections may be created. */
	canCreate: boolean;
	/** Only while expired: when enterprise features stop. */
	graceEndsAt: string | null;
	/** Only while expired: whole days until `graceEndsAt`, 0 once passed. */
	daysRemaining: number | null;
}

const COMMUNITY: License = { kind: "community" };

/**
 * `publicKey` exists for tests, which sign with a throwaway keypair. Production
 * callers never pass it.
 */
export function resolveLicense(
	key: string | undefined,
	publicKey: string | null = LICENSE_PUBLIC_KEY,
): License {
	const value = key?.trim();
	if (!value) return COMMUNITY;
	if (value === NON_COMMERCIAL) return { kind: "non_commercial" };
	if (!publicKey) {
		logger.error("LICENSE_KEY is set, but this build carries no license public key — running as community", "LICENSE");
		return COMMUNITY;
	}
	try {
		return verifySigned(value, publicKey);
	} catch (error) {
		logger.error(`LICENSE_KEY rejected, running as community: ${(error as Error).message}`, "LICENSE");
		return COMMUNITY;
	}
}

/** A compact JWS signed with EdDSA. Expiry is not checked here — expired is not invalid. */
function verifySigned(token: string, publicKey: string): License {
	const [header, payload, signature, extra] = token.split(".");
	if (!header || !payload || !signature || extra !== undefined)
		throw new Error("not a signed token");
	if (decode(header).alg !== "EdDSA") throw new Error("unsupported signing algorithm");
	const signed = Buffer.from(`${header}.${payload}`);
	if (!verify(null, signed, createPublicKey(publicKey), Buffer.from(signature, "base64url")))
		throw new Error("signature does not match");

	const claims = decode(payload);
	if (typeof claims.sub !== "string" || !claims.sub) throw new Error("missing licensee (sub)");
	if (claims.exp !== undefined && typeof claims.exp !== "number")
		throw new Error("exp must be a number");
	return {
		kind: "signed",
		licensee: claims.sub,
		expiresAt: claims.exp === undefined ? null : new Date(claims.exp * 1000).toISOString(),
	};
}

function decode(segment: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

export function entitlement(license: License, now = Date.now()): Entitlement {
	const none = { graceEndsAt: null, daysRemaining: null };
	if (license.kind === "community")
		return { status: "community", canRun: false, canCreate: false, ...none };
	if (license.kind === "non_commercial")
		return { status: "non_commercial", canRun: true, canCreate: true, ...none };

	const expiresAt = license.expiresAt ? Date.parse(license.expiresAt) : Infinity;
	if (now < expiresAt) return { status: "active", canRun: true, canCreate: true, ...none };

	// Expired: running work is left alone until the grace period ends, but
	// nothing new is created — a lapsed license must never take production down.
	const graceEndsAt = expiresAt + GRACE_PERIOD_DAYS * DAY_MS;
	return {
		status: "expired",
		canRun: now < graceEndsAt,
		canCreate: false,
		graceEndsAt: new Date(graceEndsAt).toISOString(),
		daysRemaining: Math.max(0, Math.ceil((graceEndsAt - now) / DAY_MS)),
	};
}
