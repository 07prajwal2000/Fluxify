import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "../../../lib/pagination";

/**
 * Trigger types this build knows.
 *
 * `internal` is the only one a user can create today. Cron and the external
 * connectors are the same row with a different type, so they arrive as entries
 * here rather than as a second entity.
 */
export const TRIGGER_TYPES = ["internal"] as const;
export const triggerTypeSchema = z.enum(TRIGGER_TYPES);

/**
 * Batch settings, shared by create and patch.
 *
 * The caps are not arbitrary. 10k messages in one run is already past the point
 * where a failure is cheap to re-run, and one batch has to fit in a worker's
 * memory alongside the graph running over it.
 */
const batchSchema = {
	/** Events coalesced into one run. 1 is queue mode. */
	batchSize: z.number().int().min(1).max(10_000).default(1),
	/** How long a partial batch waits for the rest. 0 means do not wait. */
	maxWaitMs: z.number().int().min(0).max(300_000).default(0),
	/** Memory bound on one batch, capped at 64MB. */
	maxBytes: z
		.number()
		.int()
		.min(1024)
		.max(64 * 1024 * 1024)
		.default(1024 * 1024),
	/** Batches in flight. Above 1 forfeits ordering. */
	concurrency: z.number().int().min(1).max(64).default(1),
};

export const createSchema = z.object({
	name: z.string().min(2).max(255),
	description: z.string().max(2000).optional(),
	type: triggerTypeSchema,
	projectId: z.uuidv7(),
	/** One trigger, one workflow — fan-out is two triggers. */
	workflowId: z.uuidv7(),
	/** Omitted means the project's default group, which always exists. */
	groupId: z.uuidv7().optional(),
	/** The connector's credentials. Never set for `internal`. */
	integrationId: z.uuidv7().optional(),
	/** Static data handed to the workflow, for sources that carry none. */
	payload: z.unknown().optional(),
	active: z.boolean().optional(),
	...batchSchema,
});

export const patchSchema = createSchema
	.omit({ projectId: true, type: true, workflowId: true })
	.partial();

export const idParamSchema = z.object({ id: z.uuidv7() });

export const createdSchema = z.object({ id: z.uuidv7() });

export const triggerSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	type: z.string(),
	projectId: z.string(),
	workflowId: z.string(),
	groupId: z.string(),
	integrationId: z.string().nullable(),
	batchSize: z.number().int(),
	maxWaitMs: z.number().int(),
	maxBytes: z.number().int(),
	concurrency: z.number().int(),
	payload: z.unknown().nullable(),
	active: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const listQuerySchema = z
	.clone(paginationRequestQuerySchema)
	.extend({
		projectId: z.uuidv7().optional(),
		workflowId: z.uuidv7().optional(),
		groupId: z.uuidv7().optional(),
		search: z.string().optional(),
		active: z.enum(["true", "false"]).optional(),
	})
	.transform((q) => ({
		page: q.page,
		perPage: q.perPage,
		projectId: q.projectId,
		workflowId: q.workflowId,
		groupId: q.groupId,
		search: q.search,
		active: q.active === undefined ? undefined : q.active === "true",
	}));

export const listSchema = z.object({
	data: z.array(triggerSchema.extend({ workflowName: z.string() })),
	pagination: paginationResponseSchema,
});

/* ------------------------------------------------------------------ groups */

export const groupSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	projectId: z.string(),
	isDefault: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const createGroupSchema = z.object({
	name: z.string().min(2).max(255),
	description: z.string().max(2000).optional(),
	projectId: z.uuidv7(),
});

export const groupListQuerySchema = z.object({ projectId: z.uuidv7() });

export const groupListSchema = z.object({ data: z.array(groupSchema) });
