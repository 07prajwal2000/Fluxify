import { logger } from "@fluxify/common";
import {
	entitlement,
	FEATURES,
	includes,
	licenseBanner,
	verifyLicenseKey,
	type Entitlement,
	type License,
} from "@fluxify/common/license";
import z from "zod";
import { createConfigStore } from "../db/configStore";
import { ForbiddenError } from "../errors/forbidError";
import { getSetting } from "../loaders/instanceSettingsLoader";

/**
 * Which edition this instance runs, and the gates that read it.
 *
 * Only the admin process sees a license key. It verifies the key and publishes
 * what it proved to the config store; every other process watches that, so a
 * worker never holds the key and never disagrees with the admin about it.
 *
 * Its own prefix, not a row in `instance_settings`: that prefix is rebuilt from
 * Postgres on every admin boot, which would briefly publish "no license" to
 * every worker, and a settings row is something the API lets an operator write.
 *
 * No database access here — workers import this file. Where the key comes from
 * is the admin's business (`api/v1/instance-settings/license`).
 */

const licenseSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("community") }),
	z.object({ kind: z.literal("non_commercial") }),
	z.object({
		kind: z.literal("signed"),
		licensee: z.string(),
		expiresAt: z.string().nullable(),
		features: z.array(z.string()),
	}),
]);

const store = createConfigStore({
	prefix: "license",
	registry: { current: { schema: licenseSchema, publicSchema: licenseSchema } },
});

/**
 * Admin process: verify a key and publish the result to every process. Never
 * throws on a bad key — it runs as community. `rejected` is a reason the key
 * was already refused for before reaching here (it could not be decrypted).
 */
export async function publishLicenseKey(key: string | undefined, rejected: string | null = null) {
	let license: License = { kind: "community" };
	try {
		if (!rejected) license = verifyLicenseKey(key);
	} catch (error) {
		rejected = (error as Error).message;
	}
	await start();
	await store.put("current", license, false);
	logEdition(license, rejected);
}

/** Every other process: fed by the watch, never by the key. */
export async function watchLicense() {
	await start();
	logEdition(currentLicense());
}

let started = false;
async function start() {
	if (started) return;
	started = true;
	try {
		await store.start();
	} catch (error) {
		// Same reasoning as instance settings: a process that cannot learn its
		// edition would be guessing.
		logger.error(`FATAL: license state unavailable — NATS KV did not start: ${String(error)}`, "LICENSE");
		process.exit(1);
	}
}

/** Absent means community — never a crash. */
function currentLicense(): License {
	return store.get("current") ?? { kind: "community" };
}

/** Read against the clock on every call, so expiry lands without a restart. */
export function currentEntitlement(): Entitlement {
	return entitlement(currentLicense());
}

/** Whether existing connectors may keep running. */
export function canRunConnectors() {
	const e = currentEntitlement();
	return e.canRun && includes(e, FEATURES.connectors);
}

/**
 * Refuses a new external connector. Licensed for connectors, and not switched
 * off by an operator. Existing connectors are not checked here — see
 * `canRunConnectors`.
 */
export function assertCanCreateConnector() {
	if (getSetting("featureflags.ee.connectors")?.enabled === false)
		throw new ForbiddenError("External connectors are switched off on this instance");
	const e = currentEntitlement();
	if (e.canCreate && includes(e, FEATURES.connectors)) return;
	throw new ForbiddenError(
		e.status === "expired"
			? "The enterprise license has expired. Existing connectors keep running, but new ones cannot be created until it is renewed"
			: e.canCreate
				? "Your license does not include external connectors"
				: "External connectors need an enterprise license",
	);
}

/**
 * A one-line log for log shipping, plus a boxed banner on the raw console so
 * the edition is not lost among the boot logs. Red when something is wrong.
 */
function logEdition(license: License, rejected: string | null = null) {
	const { status, daysRemaining } = entitlement(license);
	const edition = status === "community" ? "community" : "enterprise";
	const suffix = status === "expired" ? `, ${daysRemaining} day(s) of grace left` : "";
	if (rejected) logger.error(`License key rejected, running as community: ${rejected}`, "LICENSE");
	logger.info(`edition: ${edition} (license ${status}${suffix})`, "LICENSE");

	const { ok, text } = licenseBanner(license, rejected);
	if (ok) console.log(`\n${text}\n`);
	// Colour each line: runners that prefix output (bun run, compose) reset it at every newline.
	else console.error(process.env.NO_COLOR ? `\n${text}\n` : `\n${text.replace(/^.*$/gm, "\x1b[31m$&\x1b[0m")}\n`);
}
