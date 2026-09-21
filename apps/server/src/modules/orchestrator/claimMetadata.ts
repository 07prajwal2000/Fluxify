import { z } from "zod";

/**
 * A claim's optional settings, stored as one jsonb column (#429) so a new knob
 * is a key rather than a migration.
 *
 * Nothing here names a platform. Which platform runs a claim is the
 * orchestrator's `ORCHESTRATOR_PROVIDER`, never the row's — so moving an
 * instance between Docker and Kubernetes changes one env var and no data. A
 * setting that only means something on one platform goes under its own key
 * (`kubernetes: {...}`) and the other driver ignores it.
 */

/**
 * What one node of the claim may use. Every workload has its own size, so
 * this is the claim's rather than the pool's. Docker applies it as limits;
 * Kubernetes as requests and limits both, which is also what its CPU and
 * memory autoscaling measure against.
 */
export const claimResourcesSchema = z.object({
	cpu: z.number().min(0.5).max(16).multipleOf(0.5),
	memoryMb: z.number().int().min(256).max(65_536).multipleOf(256),
});

export type ClaimResources = z.infer<typeof claimResourcesSchema>;

export const DEFAULT_RESOURCES: ClaimResources = { cpu: 1, memoryMb: 1024 };

/** Checked on write. Every key is optional: an absent one means its default. */
export const claimMetadataSchema = z.object({
	resources: claimResourcesSchema.partial().optional(),
});

export type ClaimMetadata = z.infer<typeof claimMetadataSchema>;

/**
 * A claim's resources with the defaults filled in. Read without validating:
 * the row was checked when it was written, and one odd row must not fail the
 * whole reconcile pass.
 */
export function claimResources(metadata: ClaimMetadata | null | undefined): ClaimResources {
	return { ...DEFAULT_RESOURCES, ...metadata?.resources };
}
