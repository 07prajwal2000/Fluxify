import { logger } from "@fluxify/common";
import { artifactStore } from "../../db/natsKv";

/** An ephemeral run (#741) lives for one call, at most the 30 seconds a call may wait. */
const MAX_AGE_MS = 60 * 60_000;

/**
 * Deletes ephemeral artifacts a crash left in the development bucket: the run's
 * own `finally` deletes its key, but an admin that died between the put and the
 * delete cannot. Only keys that carry the `eph_` id and are over an hour old.
 */
export async function sweepEphemeralArtifacts(now = Date.now()) {
	const store = await artifactStore("development");
	let swept = 0;
	for (const key of await store.keys("sandbox.*.*")) {
		if (!key.split(".")[2]?.startsWith("eph_")) continue;
		const value = (await store.get(key)) as { compiledAt?: string } | null;
		const age = now - Date.parse(value?.compiledAt ?? "");
		// no value, or no readable time: nothing a live run could still be holding
		if (value && age <= MAX_AGE_MS) continue;
		await store.delete(key);
		swept++;
	}
	if (swept) logger.debug(`[ephemeral] swept ${swept} leftover artifact(s)`, "EPHEMERAL");
	return swept;
}
