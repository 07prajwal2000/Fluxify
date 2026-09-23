import type { InfraProvider, ObservedNode } from "@fluxify/common/orchestrator";
import type { PoolLimits } from "../desired";
import type { ForwardEdit } from "../nodeClaims";
import type { Claim, DesiredNode } from "../projection";
import type { NodeEvent } from "../records";
import type { ScalingContext } from "../scaling";

/**
 * What the reconcile loop needs from a platform, and nothing more.
 *
 * The seam is "make it match" rather than create / scale / delete, because the
 * platforms work at different sizes: Docker creates and replaces one container
 * at a time, Kubernetes writes one Deployment per claim and lets KEDA pick the
 * number. Each driver keeps its own pure planner at its own size; a seam shaped
 * around one container would drag Docker's planning into every other driver.
 *
 * A driver reports the events it caused instead of recording them. Everything
 * that writes to Postgres or NATS — node rows, history, assignment records, the
 * published inventory — is the same on every platform and stays in the loop.
 */
export interface InfraDriver {
	provider: InfraProvider;
	/** Facts worth showing an operator, published on the lease (§14.5). */
	meta: Record<string, string | number | boolean>;
	/** Checked once at startup: an unreachable platform is a fatal misconfiguration. */
	reachable(): Promise<boolean>;
	/** Every node carrying this orchestrator's label, and only those. */
	observe(): Promise<ObservedNode[]>;
	/**
	 * Moves the platform towards `desired`. Never throws for a single failed
	 * action: one image that will not pull must not stop the rest of the pass,
	 * so a failure comes back as an event like any other.
	 */
	apply(
		desired: readonly DesiredNode[],
		observed: readonly ObservedNode[],
		ctx: ApplyContext,
	): Promise<NodeEvent[]>;
	/**
	 * Mirrors claims into a resource people can edit on the platform itself, and
	 * hands edits made there to `forward` (#448). Kubernetes only. Runs after
	 * `apply`, so an accepted edit is built on the next pass from the row admin
	 * wrote — never from the resource.
	 */
	syncClaims?(
		claims: readonly Claim[],
		desired: readonly DesiredNode[],
		observed: readonly ObservedNode[],
		forward: ForwardEdit,
	): Promise<void>;
	/** Optional kinds the platform does not have installed, for the portal to name. */
	missing?(): string[];
}

/** What changes between passes. Fixed settings are given when a driver is built. */
export interface ApplyContext {
	pool: PoolLimits;
	/** Docker runs every claim at its floor and ignores this until it grows an executor. */
	scaling: ScalingContext;
}
