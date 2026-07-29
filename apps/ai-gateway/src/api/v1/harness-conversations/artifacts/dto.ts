import { z } from "zod";

export const subArtifactParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
	subArtifactId: z.string().min(1),
});

export const runParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
	runId: z.string().min(1),
});

export const artifactParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
	artifactId: z.string().min(1),
});

/** List shape — deliberately no `payload`: a canvas graph is tens of KB and the
 *  list only drives chips. Fetch one by id to get the payload. */
export const subArtifactSummarySchema = z.object({
	id: z.string(),
	artifactId: z.string(),
	kind: z.string(),
	action: z.string().nullable(),
	appliedAt: z.union([z.string(), z.date()]).nullable(),
	createdAt: z.union([z.string(), z.date()]),
});

export const listResponseSchema = z.object({
	subArtifacts: z.array(subArtifactSummarySchema),
});

export const subArtifactDetailSchema = subArtifactSummarySchema.extend({
	conversationId: z.string(),
	runId: z.string(),
	subAgentId: z.string().nullable(),
	payload: z.record(z.string(), z.any()),
});

export const applySubArtifactResponseSchema = z.object({
	id: z.string(),
	kind: z.string(),
	action: z.string().nullable(),
	appliedAt: z.union([z.string(), z.date()]),
});

export const applyArtifactResponseSchema = z.object({
	artifactId: z.string(),
	appliedAt: z.union([z.string(), z.date()]),
	/** Route outputs first — the order the project mutation must run in. */
	applied: z.array(
		z.object({
			id: z.string(),
			kind: z.string(),
			action: z.string().nullable(),
		}),
	),
});
