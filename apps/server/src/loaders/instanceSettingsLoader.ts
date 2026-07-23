import { db } from "../db";
import { instanceSettingsEntity } from "../db/schema";
import {
	CHAN_ON_INSTANCE_SETTING_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { logger } from "@fluxify/common";
import {
	INSTANCE_SETTINGS_REGISTRY,
	InstanceSettingKey,
	InstanceSettingValue,
	isInstanceSettingKey,
} from "../lib/instance-settings/schemas";
import { initializeAuth } from "../lib/auth";

type CacheEntry = { value: unknown; isPublic: boolean };

let cache: Partial<Record<InstanceSettingKey, CacheEntry>> = {};

export async function loadInstanceSettings() {
	await loadFromDB();
	subscribeToChannel(CHAN_ON_INSTANCE_SETTING_CHANGE, async () => {
		logger.info("instance settings reloaded");
		await loadFromDB();
		initializeAuth(db); // rebuild global `auth` with fresh sso_config
	});
}

async function loadFromDB() {
	const next: Partial<Record<InstanceSettingKey, CacheEntry>> = {};
	const rows = await db.select().from(instanceSettingsEntity);
	for (const row of rows) {
		if (!isInstanceSettingKey(row.key)) continue; // unknown key, ignore
		const parsed = INSTANCE_SETTINGS_REGISTRY[row.key].schema.safeParse(
			row.value,
		);
		if (!parsed.success) {
			logger.warn(`instance_settings '${row.key}' invalid, skipping`);
			continue;
		}
		next[row.key] = { value: parsed.data, isPublic: row.isPublic };
	}
	cache = next;
}

/** Typed, nullable getter keyed by the discriminated union. */
export function getSetting<K extends InstanceSettingKey>(
	key: K,
): InstanceSettingValue<K> | null {
	return (cache[key]?.value as InstanceSettingValue<K>) ?? null;
}

/** Public feature flags: only `is_public` rows, secrets stripped via publicSchema. */
export function getPublicSettings(): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(cache) as InstanceSettingKey[]) {
		const entry = cache[key]!;
		if (!entry.isPublic) continue;
		out[key] = INSTANCE_SETTINGS_REGISTRY[key].publicSchema.parse(entry.value);
	}
	return out;
}
