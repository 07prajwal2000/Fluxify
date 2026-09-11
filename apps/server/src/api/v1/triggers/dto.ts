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
export const TRIGGER_TYPES = ["internal", "schedule", "kafka", "nats", "sqs"] as const;
export const triggerTypeSchema = z.enum(TRIGGER_TYPES);

export { isEnterpriseTriggerType } from "../../../modules/triggers/types";

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

/** External queues only; ignored by `internal` and `schedule`. */
const connectorSchema = {
	/** What to read, in the connector's terms. Kafka: `{ topics, fromBeginning? }`. */
	source: z.record(z.string(), z.unknown()).optional(),
	/** `auto` commits after a successful run; `manual` leaves it to the workflow. */
	commitMode: z.enum(["auto", "manual"]).default("auto"),
	/** Runs of one batch before it is dead-lettered (auto) or handed back (manual). */
	maxAttempts: z.number().int().min(1).max(5).default(3),
	/** Base delay; doubles after each failed attempt. */
	retryDelayMs: z.number().int().min(0).max(300_000).default(1000),
};

/** Kafka's own caps: 249 characters a topic name; 100 topics is plenty for one workflow. */
export const kafkaSourceSchema = z.object({
	topics: z.array(z.string().min(1).max(249)).min(1).max(100),
	fromBeginning: z.boolean().optional(),
	/** Create missing topics on save; off, a missing topic is a 400. */
	createTopics: z.boolean().optional(),
});

/** NATS stream names cannot hold whitespace, `.`, `*`, `>`, or path separators. */
export const natsSourceSchema = z.object({
	stream: z.string().regex(/^[^\s.*>/\\]{1,255}$/, "Not a valid stream name"),
	filterSubjects: z.array(z.string().min(1)).max(100).optional(),
	fromBeginning: z.boolean().optional(),
});

/** SQS's own limits: a long poll waits at most 20s, a message hides at most 12h. */
export const sqsSourceSchema = z.object({
	queueUrl: z.url(),
	waitTimeSeconds: z.number().int().min(0).max(20).optional(),
	visibilityTimeoutSec: z.number().int().min(1).max(43_200).optional(),
});

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
	 * The workflow this trigger starts. May be omitted: a trigger created from
	 * the Triggers page before its workflow exists is saved and idle, not broken.
	 */
	workflowId: z.uuidv7().optional(),
	/** Omitted means the project's default group, which always exists. */
	groupId: z.uuidv7().optional(),
	/** The connector's credentials. Never set for `internal`. */
	integrationId: z.uuidv7().optional(),
	/** Static data handed to the workflow, for sources that carry none. */
	payload: z.unknown().optional(),
	active: z.boolean().optional(),
	...batchSchema,
	...scheduleSchema,
	...connectorSchema,
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
		/** Null detaches the workflow and idles the trigger. */
		workflowId: z.uuidv7().nullable(),
		payload: z.unknown(),
		active: z.boolean(),
		...batchSchema,
		...scheduleSchema,
		...connectorSchema,
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
	workflowId: z.string().nullable(),
	groupId: z.string(),
	integrationId: z.string().nullable(),
	batchSize: z.number().int(),
	maxWaitMs: z.number().int(),
	maxBytes: z.number().int(),
	concurrency: z.number().int(),
	payload: z.unknown().nullable(),
	source: z.unknown().nullable(),
	commitMode: z.string(),
	maxAttempts: z.number().int(),
	retryDelayMs: z.number().int(),
	schedule: z.string().nullable(),
	timezone: z.string(),
	active: z.boolean(),
	/** Set when the system switched it off, e.g. its queue was deleted; null otherwise. */
	disabledReason: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** Settings that work but that the user should know about, e.g. no dead-letter queue. */
const warningsSchema = z.array(z.string());
export const triggerCreatedSchema = createdSchema.extend({ warnings: warningsSchema });
export const triggerUpdatedSchema = triggerSchema.extend({ warnings: warningsSchema });

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

/** A trigger as a list shows it: the workflow comes with its name. */
export const workflowLinkSchema = z.object({ id: z.string(), name: z.string() });

export const listSchema = z.object({
	data: z.array(triggerSchema.extend({ workflow: workflowLinkSchema.nullable() })),
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
