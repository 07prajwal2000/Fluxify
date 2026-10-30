import { createHash } from "node:crypto";
import { TRIGGERS_STREAM_SPEC } from "../triggers/subjects";
import type { JobEnvelope } from "./types";

/**
 * What the execution process knows about stopped runs: the stop entries, and the
 * runs with a Run ID it is holding. It owns no NATS connection, so entries arrive
 * from the supervisor over IPC, and a run that has ended asks the supervisor to
 * delete the entry that stopped it.
 */

/** One entry of the stop bucket. `stoppedAt` and `revision` are the broker's. */
export type RunStop = {
	key: string;
	projectId: string;
	runKey: string;
	stoppedAt: number;
	revision: number;
};

/** A message lives this long on the triggers stream, so an older stop can match nothing. */
export const STOP_TTL_MS = TRIGGERS_STREAM_SPEC.maxAgeMs;

/** Hashed: a Run ID is any text, and a KV key cannot hold most of it, or `*` and `>`. */
export const stopKey = (projectId: string, runKey: string) =>
	`${projectId}.${createHash("sha256").update(runKey).digest("hex")}`;

/** The current entry per key. An entry that expires sends no event, so age is checked here. */
export class StopLedger {
	private readonly stops = new Map<string, RunStop>();

	set(stop: RunStop) {
		this.prune();
		this.stops.set(stop.key, stop);
	}

	get(key: string) {
		return this.stops.get(key);
	}

	delete(key: string) {
		this.stops.delete(key);
	}

	list() {
		this.prune();
		return [...this.stops.values()];
	}

	private prune() {
		const oldest = Date.now() - STOP_TTL_MS;
		for (const [key, stop] of this.stops) if (stop.stoppedAt < oldest) this.stops.delete(key);
	}
}

/**
 * The time rule: a stop applies only to runs fired before it, so a reused id runs
 * normally afterwards. On a tie the stop wins: both times are in milliseconds, and
 * a stop right behind its run is far likelier than a re-fire right behind a stop.
 */
export const stopApplies = (firedAt: number, stop: RunStop) => firedAt <= stop.stoppedAt;

type ActiveRun = { firedAt: number; controller: AbortController; stoppedBy?: RunStop };

const ledger = new StopLedger();
const active = new Map<string, Set<ActiveRun>>();
let clearer: ((key: string, revision: number) => void) | undefined;

/** Called once by the host process: how an ended run reaches the supervisor. */
export function setRunStopClearer(next?: (key: string, revision: number) => void) {
	clearer = next;
}

/** Remembers the entry for runs not started yet, and aborts the matching active ones. */
export function applyRunStop(stop: RunStop) {
	ledger.set(stop);
	for (const run of active.get(stop.key) ?? []) {
		if (!run.stoppedBy && stopApplies(run.firedAt, stop)) {
			run.stoppedBy = stop;
			run.controller.abort();
		}
	}
}

export function forgetRunStop(key: string) {
	ledger.delete(key);
}

/**
 * Tracks one run, or returns undefined for a run with no Run ID: no signal, no
 * tracking and no check. A run a stop already reached comes back aborted.
 *
 * `end` clears only the entry that stopped this run. A newer one on a reused id
 * stays, and it stays even if this process has not heard of it yet, because the
 * delete is conditional on the revision.
 */
export function trackRun(job: JobEnvelope) {
	if (!job.runKey || job.firedAt === undefined) return undefined;
	const key = stopKey(job.projectId, job.runKey);
	const run: ActiveRun = { firedAt: job.firedAt, controller: new AbortController() };
	const known = ledger.get(key);
	if (known && stopApplies(job.firedAt, known)) {
		run.stoppedBy = known;
		run.controller.abort();
	}
	const runs = active.get(key) ?? new Set<ActiveRun>();
	active.set(key, runs.add(run));

	return {
		signal: run.controller.signal,
		end() {
			runs.delete(run);
			if (runs.size === 0 && active.get(key) === runs) active.delete(key);
			if (!run.stoppedBy || ledger.get(key)?.revision !== run.stoppedBy.revision) return;
			ledger.delete(key);
			clearer?.(key, run.stoppedBy.revision);
		},
	};
}
