import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "../../../lib/pagination";

/**
 * A workflow has no path, method or request schemas — it is not addressed over
 * HTTP. What a route spends on its HTTP contract, a workflow spends on
 * `payloadSchema`: the shape a trigger (or a manual test run) must supply.
 */
export const createSchema = z.object({
	name: z.string().min(2).max(255),
	description: z.string().max(2000).optional(),
	projectId: z.uuidv7(),
	payloadSchema: z.any().optional(),
	// A background job is allowed to be slower than a request, but not endless.
	timeoutSeconds: z.number().int().min(30).max(3600).default(300),
	active: z.boolean().optional(),
	tracingEnabled: z.boolean().optional(),
	recordExecution: z.boolean().optional(),
});

export const patchSchema = createSchema
	.omit({ projectId: true })
	.partial()
	.extend({ payloadSchema: z.any().optional() });

export const idParamSchema = z.object({ id: z.uuidv7() });

export const createdSchema = z.object({ id: z.uuidv7() });

export const workflowSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	active: z.boolean().nullable(),
	payloadSchema: z.any().nullable(),
	timeoutSeconds: z.number().int(),
	tracingEnabled: z.boolean(),
	recordExecution: z.boolean(),
	projectId: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const listQuerySchema = z
	.clone(paginationRequestQuerySchema)
	.extend({
		projectId: z.uuidv7().optional(),
		search: z.string().optional(),
		active: z.enum(["true", "false"]).optional(),
	})
	.transform((q) => ({
		page: q.page,
		perPage: q.perPage,
		projectId: q.projectId,
		search: q.search,
		active: q.active === undefined ? undefined : q.active === "true",
	}));

export const listSchema = z.object({
	data: z.array(workflowSchema.extend({ projectName: z.string() })),
	pagination: paginationResponseSchema,
});

/**
 * A test run's payload. Anything JSON is accepted as-is; a string is accepted
 * too, so a workflow triggered by plain text has something to receive. Binary
 * is the caller's to encode — send base64 or hex with a media type describing
 * it, the same way an image travels through JSON anywhere else.
 */
export const runSchema = z.object({
	payload: z.unknown().optional(),
});

export const runAcceptedSchema = z.object({
	/** The job id, so the run can be correlated in logs and traces. */
	id: z.string(),
	accepted: z.literal(true),
});
