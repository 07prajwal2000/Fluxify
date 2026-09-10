import { createHash } from "node:crypto";
import {
	entitlement,
	NON_COMMERCIAL,
	verifyLicenseKey,
	type License,
} from "@fluxify/common/license";
import type z from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { EncryptionService } from "../../../../lib/encryption";
import { getEnv } from "../../../../lib/env";
import { publishLicenseKey } from "../../../../lib/edition";
import { getSetting } from "../../../../loaders/instanceSettingsLoader";
import type { LicenseView, setLicenseBodySchema } from "./dto";
import { getStoredLicense, saveStoredLicense } from "./repository";

/**
 * Where the license key comes from, in order: the LICENSE_KEY env var, the
 * edition set in the admin UI, then the default — non-commercial.
 *
 * The key never leaves this file except as a fingerprint.
 */

type Configured = Awaited<ReturnType<typeof configuredKey>>;

async function configuredKey() {
	const envKey = getEnv("LICENSE_KEY")?.trim();
	if (envKey) return { source: "env" as const, key: envKey, error: null, row: null };
	const row = await getStoredLicense();
	if (!row) return { source: "default" as const, key: NON_COMMERCIAL, error: null, row: null };
	if (row.key === null) return { source: "ui" as const, key: undefined, error: null, row };
	try {
		return { source: "ui" as const, key: EncryptionService.decrypt(row.key), error: null, row };
	} catch {
		// Most likely MASTER_ENCRYPTION_KEY changed since the key was saved.
		const error = "the saved license key could not be decrypted";
		return { source: "ui" as const, key: undefined, error, row };
	}
}

/** Admin boot: publish whatever is configured. */
export async function publishConfiguredLicense() {
	const { key, error } = await configuredKey();
	await publishLicenseKey(key, error);
}

export async function getLicenseView(): Promise<LicenseView> {
	return toView(await configuredKey());
}

export async function setLicense(body: z.infer<typeof setLicenseBodySchema>, userId: string) {
	if (getEnv("LICENSE_KEY")?.trim())
		throw new BadRequestError(
			"The license is set by the LICENSE_KEY environment variable. Remove it from the admin's environment to manage the license here.",
		);
	const key = body.edition === "community" ? null : body.edition === "non_commercial" ? NON_COMMERCIAL : checkNewKey(body.key);
	const confirmed = body.edition === "non_commercial";
	await saveStoredLicense({
		key: key === null ? null : EncryptionService.encrypt(key),
		confirmedBy: confirmed ? userId : null,
		confirmedAt: confirmed ? new Date() : null,
	});
	await publishLicenseKey(key ?? undefined);
	return getLicenseView();
}

/** A new key must verify and must not already be expired — the grace period is for renewing, not for starting. */
function checkNewKey(key: string) {
	let license: License;
	try {
		license = verifyLicenseKey(key);
	} catch (error) {
		throw new BadRequestError(`License key rejected: ${(error as Error).message}`);
	}
	if (license.kind !== "signed") throw new BadRequestError("That is not a license key");
	if (entitlement(license).status === "expired")
		throw new BadRequestError("This license key has expired. Paste a renewed key");
	return key;
}

function toView({ source, key, error, row }: Configured): LicenseView {
	let license: License = { kind: "community" };
	let invalidReason = error;
	try {
		if (!error) license = verifyLicenseKey(key);
	} catch (e) {
		invalidReason = (e as Error).message;
	}
	const e = entitlement(license);
	const signed = license.kind === "signed" ? license : null;
	return {
		source,
		// The edition actually running: a key that does not verify runs as community.
		edition: invalidReason || !key ? "community" : key === NON_COMMERCIAL ? "non_commercial" : "enterprise",
		status: invalidReason ? "invalid" : e.status,
		invalidReason,
		licensee: signed?.licensee ?? null,
		expiresAt: signed?.expiresAt ?? null,
		graceEndsAt: e.graceEndsAt,
		daysRemaining: e.daysRemaining,
		features: e.features,
		fingerprint: key && key !== NON_COMMERCIAL ? fingerprint(key) : null,
		connectorsSwitchedOff: getSetting("featureflags.ee.connectors")?.enabled === false,
		confirmedBy: row?.confirmedByEmail ? { name: row.confirmedByName, email: row.confirmedByEmail } : null,
		confirmedAt: row?.confirmedAt?.toISOString() ?? null,
	};
}

function fingerprint(key: string) {
	return `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}
