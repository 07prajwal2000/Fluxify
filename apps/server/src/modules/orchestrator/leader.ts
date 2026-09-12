import { logger } from "@fluxify/common";
import { openKvBucket, type KvBucket } from "@fluxify/common/nats";
import {
	ORCHESTRATOR_LEASE_BUCKET,
	ORCHESTRATOR_LEASE_TTL_MS,
	orchestratorKeys,
	type OrchestratorLease,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../db/nats";

/**
 * One orchestrator reconciles at a time.
 *
 * Two of them would create the same container twice and fight over its labels,
 * so the right to reconcile is a single key with a countdown on it: whoever
 * writes it first owns it, and it evaporates on its own if that process dies.
 * A standby then takes over within the TTL without anyone deciding that the
 * leader is gone.
 *
 * Active/standby, not sharded (§9). Docker is one host, so there is no
 * reconcile volume to spread — the extra replica is for availability. The one
 * concession to sharding later is elsewhere: desired state is keyed per project
 * so a shard can own a key prefix, which a single global blob would have made a
 * migration.
 */

/**
 * The lease value doubles as what admin displays about the running
 * orchestrator (§14.5): which infrastructure it drives, how often it acts, and
 * whatever facts that provider has worth showing. The lease is already written
 * every pass and already expires on its own, so a dead orchestrator stops
 * answering with no row for anyone to clean up.
 */
type LeaseRecord = OrchestratorLease;

/** What this process is, minus the parts the lease fills in on every renewal. */
export type LeaseIdentity = Pick<OrchestratorLease, "provider" | "reconcileIntervalMs"> &
	Partial<Pick<OrchestratorLease, "meta">>;

export interface LeaderLease {
	/**
	 * Takes the lease, or renews one already held. True means this process may
	 * reconcile right now — call it at the top of every loop rather than
	 * trusting a flag, because the answer can change while the loop sleeps.
	 */
	tick(): Promise<boolean>;
	/** Hands the lease over immediately instead of making the standby wait out the TTL. */
	release(): Promise<void>;
}

/**
 * The three operations a lease is: write if empty, write if unchanged, and
 * drop. Named as a subset so the logic can be exercised against a fake that
 * enforces exactly those rules — the interesting cases are a key that expired
 * and a key someone else now holds, and neither is reachable through a broker
 * on a timer.
 */
type LeaseStore = Pick<KvBucket<LeaseRecord>, "create" | "update" | "delete">;

export async function openLeaderLease(
	holder: string,
	identity: LeaseIdentity,
): Promise<LeaderLease> {
	const nc = await initializeNats();
	return createLease(
		await openKvBucket<LeaseRecord>(nc, ORCHESTRATOR_LEASE_BUCKET, {
			ttlMs: ORCHESTRATOR_LEASE_TTL_MS,
		}),
		holder,
		identity,
	);
}

export function createLease(
	bucket: LeaseStore,
	holder: string,
	// Defaulted rather than required: the lease's job is mutual exclusion, and
	// the metadata rides along with it. A test exercising the three store rules
	// should not have to describe a provider.
	identity: LeaseIdentity = { provider: "docker", reconcileIntervalMs: 0 },
): LeaderLease {
	const key = orchestratorKeys.leader;
	/** The revision we wrote, which is what makes a renewal safe. Null = not ours. */
	let held: number | null = null;

	async function tick() {
		const record: LeaseRecord = {
			holder,
			at: new Date().toISOString(),
			provider: identity.provider,
			reconcileIntervalMs: identity.reconcileIntervalMs,
			meta: identity.meta ?? {},
		};
		try {
			if (held !== null) {
				// Revision-checked, not a blind write: a process paused long enough
				// for its lease to expire must not overwrite the leader that took
				// over while it was away.
				const renewed = await bucket.update(key, record, held);
				if (renewed !== null) {
					held = renewed;
					return true;
				}
				held = null;
				logger.warn("lost the orchestrator lease — standing by", "ORCHESTRATOR.leader");
			}
			const taken = await bucket.create(key, record);
			if (taken === null) return false;
			held = taken;
			logger.info(`acquired the orchestrator lease as ${holder}`, "ORCHESTRATOR.leader");
			return true;
		} catch (error) {
			// Without a lease this process must not act, but a broker blip is not
			// a reason to exit: the next tick tries again, and if this really was
			// the leader dying the key expires and the standby takes over.
			held = null;
			logger.warn(`lease check failed: ${String(error)}`, "ORCHESTRATOR.leader");
			return false;
		}
	}

	return {
		tick,
		async release() {
			if (held === null) return;
			held = null;
			await bucket
				.delete(key)
				.catch((error) =>
					logger.warn(`could not release the lease: ${String(error)}`, "ORCHESTRATOR.leader"),
				);
		},
	};
}
