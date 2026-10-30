import { openKvBucket } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import type { FluxifyEnv } from "../../lib/env";
import { type RunStop, STOP_TTL_MS, stopKey } from "../jobs/runStops";
import { ALL_PROJECTS } from "./subjects";

/**
 * Stop entries on Fluxify's internal NATS, one bucket per environment.
 *
 * KV rather than pub/sub: the run may be queued, waiting for a retry, or on a
 * child that is restarting, and a watcher gets the current values on connect.
 * Runs clear their entries as they end; the TTL is the fallback for a stop that
 * matched no run, or a worker that died.
 */
export const RUN_STOPS_BUCKET = "fluxify_run_stops";

type StopValue = Pick<RunStop, "projectId" | "runKey">;

// Opened per call: stops are rare, and a stop that fails should try again from scratch.
const bucket = (env?: FluxifyEnv) =>
	openKvBucket<StopValue>(natsConnection(), natsName(RUN_STOPS_BUCKET, env), {
		ttlMs: STOP_TTL_MS,
	});

export async function putRunStop(projectId: string, runKey: string, env?: FluxifyEnv) {
	await (await bucket(env)).put(stopKey(projectId, runKey), { projectId, runKey });
}

/** Deletes the entry only while it is still at `revision`: a newer stop survives. */
export async function clearRunStop(key: string, revision: number, env?: FluxifyEnv) {
	await (await bucket(env)).delete(key, revision);
}

/** Current entries, then every change. A key that went away arrives as null. */
export async function watchRunStops(
	projectId: string,
	onChange: (key: string, stop: RunStop | null) => void,
	env?: FluxifyEnv,
) {
	const filter = projectId === ALL_PROJECTS ? ">" : `${projectId}.>`;
	return (await bucket(env)).watch(filter, (key, value, entry) =>
		onChange(
			key,
			value && entry
				? { key, ...value, stoppedAt: entry.created.getTime(), revision: entry.revision }
				: null,
		),
	);
}
