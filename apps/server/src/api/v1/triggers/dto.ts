import { z } from "zod";
import { assertSchedule, ScheduleError } from "@fluxify/common/schedule";
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
export const TRIGGER_TYPES = ["internal", "schedule"] as const;
export const triggerTypeSchema = z.enum(TRIGGER_TYPES);

/**
 * External connectors, which need an enterprise license to create. Empty until
 * the first connector lands; adding one here is what puts it behind the gate.
 */
const ENTERPRISE_TRIGGER_TYPES: readonly string[] = [];

export function isEnterpriseTriggerType(type: string) {
	return ENTERPRISE_TRIGGER_TYPES.includes(type);
}

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
	/**
	 * How long a partial batch waits for the rest. 0 means do not wait.
	 * A full batch always returns straight away; this is only the ceiling on
	 * waiting for a part-filled one, and the broker's own floor is one second,
	 * so anything between 1 and 999 behaves as 1000.
	 */
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

/**
 * A cron that fails silently at 3am is the worst failure this feature has, so
 * the expression is parsed at the API boundary and a bad one is a 400 the user
 * reads now — not a trigger that quietly never fires.
 *
 * The default is UTC. A cron in a zone that observes daylight saving can be
 * skipped or run twice a year, and that is a choice a user should make on
 * purpose rather than inherit from the server's clock.
 */
const scheduleSchema = {
	/** `@at <rfc3339>`, `@every 5m`, `@daily`, or six-field cron (seconds first). */
	schedule: z.string().min(1).max(255).optional(),
	/** IANA name only. A fixed offset like `+05:30` silently opts out of DST. */
	timezone: z.string().max(64).default("UTC"),
};

export const createSchema = z.object({
	name: z.string().min(2).max(255),
	description: z.string().max(2000).optional(),
	type: triggerTypeSchema,
	projectId: z.uuidv7(),
	/**
	 * The workflows this trigger starts. May be empty: a trigger is a reusable
	 * source, and one created from the Triggers page before any workflow is
	 * attached is a normal intermediate state, not a broken row.
	 */
	workflowIds: z.array(z.uuidv7()).default([]),
	/** Omitted means the project's default group, which always exists. */
	groupId: z.uuidv7().optional(),
	/** The connector's credentials. Never set for `internal`. */
	integrationId: z.uuidv7().optional(),
	/** Static data handed to the workflow, for sources that carry none. */
	payload: z.unknown().optional(),
	active: z.boolean().optional(),
	...batchSchema,
	...scheduleSchema,
}).superRefine(assertScheduleShape);

/**
 * Patch cannot reuse `createSchema.omit(...)` — the refinement above needs the
 * type, and a patch does not carry one. The shape is rebuilt from the same
 * pieces and the schedule is validated on its own.
 */
export const patchSchema = z
	.object({
		name: z.string().min(2).max(255),
		description: z.string().max(2000),
		groupId: z.uuidv7(),
		integrationId: z.uuidv7(),
		/** Replaces the link set wholesale. Omit to leave the links alone. */
		workflowIds: z.array(z.uuidv7()),
		payload: z.unknown(),
		active: z.boolean(),
		...batchSchema,
		...scheduleSchema,
	})
	.partial()
	.superRefine((data, ctx) => {
		if (data.schedule) assertValidSchedule(data.schedule, data.timezone, ctx);
	});

export const idParamSchema = z.object({ id: z.uuidv7() });

/**
 * The portal asks the server what a schedule means rather than working it out
 * itself. Same parser, same timezone database, so the preview a user confirms
 * is the schedule the broker will run.
 */
export const previewQuerySchema = z.object({
	schedule: z.string().min(1).max(255),
	timezone: z.string().max(64).default("UTC"),
});

export const previewSchema = z.object({
	/** One line of English, e.g. "Every weekday at 09:00 (UTC)". */
	description: z.string(),
	/** The next few fires as ISO instants, newest last. Empty for a past one-shot. */
	nextFires: z.array(z.string()),
});

export const workflowIdParamSchema = z.object({
	id: z.uuidv7(),
	workflowId: z.uuidv7(),
});

export const createdSchema = z.object({ id: z.uuidv7() });

export const triggerSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	type: z.string(),
	projectId: z.string(),
	workflowIds: z.array(z.string()),
	groupId: z.string(),
	integrationId: z.string().nullable(),
	batchSize: z.number().int(),
	maxWaitMs: z.number().int(),
	maxBytes: z.number().int(),
	concurrency: z.number().int(),
	payload: z.unknown().nullable(),
	schedule: z.string().nullable(),
	timezone: z.string(),
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

/** A trigger as a list shows it: the linked workflows come with their names. */
export const workflowLinkSchema = z.object({ id: z.string(), name: z.string() });

export const listSchema = z.object({
	data: z.array(triggerSchema.extend({ workflows: z.array(workflowLinkSchema) })),
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

/* -------------------------------------------------------------- schedules */

type Ctx = z.core.$RefinementCtx;

/** Turns a parse failure into a field error the form can show in place. */
function assertValidSchedule(spec: string, timezone: string | undefined, ctx: Ctx) {
	try {
		assertSchedule(spec, timezone || "UTC");
	} catch (error) {
		ctx.addIssue({
			code: "custom",
			path: error instanceof ScheduleError && /timezone|IANA/.test(error.message)
				? ["timezone"]
				: ["schedule"],
			message: error instanceof ScheduleError ? error.message : String(error),
		});
	}
}

/**
 * A schedule trigger without a schedule would be a row that can never fire, and
 * a schedule on any other type would be a field that silently does nothing.
 */
function assertScheduleShape(
	data: { type: string; schedule?: string; timezone?: string },
	ctx: Ctx,
) {
	if (data.type === "schedule") {
		if (!data.schedule)
			return ctx.addIssue({
				code: "custom",
				path: ["schedule"],
				message: "A schedule trigger needs a schedule",
			});
		return assertValidSchedule(data.schedule, data.timezone, ctx);
	}
	if (data.schedule)
		ctx.addIssue({
			code: "custom",
			path: ["schedule"],
			message: `A ${data.type} trigger is not fired on a schedule`,
		});
}
