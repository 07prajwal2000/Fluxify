import { logger } from "@fluxify/common";
import {
	entitlement,
	resolveLicense,
	type Entitlement,
	type License,
} from "@fluxify/common/license";
import z from "zod";
import { createConfigStore } from "../db/configStore";
import { ForbiddenError } from "../errors/forbidError";
import { getSetting } from "../loaders/instanceSettingsLoader";
import { getEnv } from "./env";

/**
 * Which edition this instance runs, and the gates that read it.
 *
 * Only the admin process reads LICENSE_KEY. It verifies the key and publishes
 * what it proved to the config store; every other process watches that, so a
 * worker never holds the key and never disagrees with the admin about it.
 *
 * Its own prefix, not a row in `instance_settings`: that prefix is rebuilt from
 * Postgres on every admin boot, which would briefly publish "no license" to
 * every worker, and a settings row is something the API lets an operator write.
 */

const licenseSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("community") }),
	z.object({ kind: z.literal("non_commercial") }),
	z.object({
		kind: z.literal("signed"),
		licensee: z.string(),
		expiresAt: z.string().nullable(),
	}),
]);

const store = createConfigStore({
	prefix: "license",
	registry: { current: { schema: licenseSchema, publicSchema: licenseSchema } },
});

/** Admin process: verify LICENSE_KEY and publish the result to every process. */
export async function publishLicense() {
	const license = resolveLicense(getEnv("LICENSE_KEY"));
	await start();
	await store.put("current", license, false);
	logEdition(license);
}

/** Every other process: fed by the watch, never by the key. */
export async function watchLicense() {
	await start();
	logEdition(currentLicense());
}

async function start() {
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

/**
 * Refuses a new external connector. Licensed, and not switched off by an
 * operator. Existing connectors are not checked here — see `canRun`.
 */
export function assertCanCreateConnector() {
	if (getSetting("featureflags.ee.connectors")?.enabled === false)
		throw new ForbiddenError("External connectors are switched off on this instance");
	const { status, canCreate } = currentEntitlement();
	if (canCreate) return;
	throw new ForbiddenError(
		status === "expired"
			? "The enterprise license has expired. Existing connectors keep running, but new ones cannot be created until it is renewed"
			: "External connectors need an enterprise license",
	);
}

function logEdition(license: License) {
	const { status, daysRemaining } = entitlement(license);
	const edition = status === "community" ? "community" : "enterprise";
	const suffix = status === "expired" ? `, ${daysRemaining} day(s) of grace left` : "";
	logger.info(`edition: ${edition} (license ${status}${suffix})`, "LICENSE");
}
