import { logger } from "@fluxify/common";
import { artifactStore } from "../../db/natsKv";
import type { CandidateArtifact } from "./candidate";

/** a test run waits at most its suites' timeouts; an hour is long past any live one */
const MAX_AGE_MS = 60 * 60_000;

/**
 * Deletes candidate artifacts (#739) a crash left in the development bucket: a
 * run's own `finally` deletes its key, but an admin that died mid-run cannot.
 * Same shape as the ephemeral sweep.
 */
export async function sweepCandidates(now = Date.now()) {
	const store = await artifactStore("development");
	let swept = 0;
	for (const key of await store.keys("candidate.*.*.*")) {
		const value = (await store.get(key)) as Pick<CandidateArtifact, "compiledAt"> | null;
		const age = now - Date.parse(value?.compiledAt ?? "");
		// no value, or no readable time: nothing a live run could still be holding
		if (value && age <= MAX_AGE_MS) continue;
		await store.delete(key);
		swept++;
	}
	if (swept) logger.info(`[candidate] swept ${swept} leftover artifact(s)`, "CANDIDATE");
	return swept;
}
