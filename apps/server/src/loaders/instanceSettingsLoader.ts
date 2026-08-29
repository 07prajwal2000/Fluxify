import { logger } from "@fluxify/common";
import { db } from "../db";
import { createConfigStore, type ConfigRow } from "../db/configStore";
import { instanceSettingsEntity } from "../db/schema";
import { initializeAuth } from "../lib/auth";
import {
	INSTANCE_SETTINGS_REGISTRY,
	InstanceSettingKey,
	InstanceSettingValue,
	isInstanceSettingKey,
} from "../lib/instance-settings/schemas";

/**
 * Instance settings, distributed over NATS KV — the first consumer of
 * `db/configStore`. The typed surface below is unchanged; only the transport
 * underneath moved off the Redis change channel.
 */
const store = createConfigStore({
	prefix: "instance_settings",
	registry: INSTANCE_SETTINGS_REGISTRY,
});

/** Authoritative rows for boot reconciliation. Admin process only. */
async function readFromDB(): Promise<ConfigRow[]> {
	const rows = await db.select().from(instanceSettingsEntity);
	return rows
		.filter((row) => isInstanceSettingKey(row.key))
		.map((row) => ({ key: row.key, value: row.value, isPublic: row.isPublic }));
}

/**
 * Admin process: Postgres is the source of truth, so this one reconciles it
 * into KV on every boot and then watches like everyone else.
 */
export async function loadInstanceSettings() {
	await start({
		reconcile: readFromDB,
		// sso_config feeds the global `auth` client, which has to be rebuilt from
		// the new value rather than pick it up on the next call.
		onChange: (key) => {
			logger.info(`instance setting '${key}' changed, reloading`);
			if (key === "sso_config" || key === "auth_config") initializeAuth(db);
		},
	});
}

/**
 * Any process that reads settings but does not own the database. Fed entirely
 * by the watch — no Postgres connection, which is the point.
 */
export async function watchInstanceSettings() {
	await start({});
}

async function start(options: Parameters<typeof store.start>[0]) {
	try {
		await store.start(options);
	} catch (error) {
		// Config cannot reach this process, so anything it serves would be
		// guesswork. Better to die where someone will see it than to come up
		// half-configured and quietly authenticate people against nothing.
		logger.error(
			`FATAL: instance settings unavailable — NATS KV did not start: ${String(error)}`,
			"CONFIG",
		);
		process.exit(1);
	}
}

/** Publishes a written setting to every process. Call after the Postgres write. */
export async function publishInstanceSetting(
	key: InstanceSettingKey,
	value: unknown,
	isPublic: boolean,
) {
	await store.put(key, value, isPublic);
}

/** Typed, nullable getter keyed by the discriminated union. */
export function getSetting<K extends InstanceSettingKey>(
	key: K,
): InstanceSettingValue<K> | null {
	return store.get(key) as InstanceSettingValue<K> | null;
}

/** Public feature flags: only `is_public` rows, secrets stripped via publicSchema. */
export function getPublicSettings(): Record<string, unknown> {
	return store.getPublic();
}
