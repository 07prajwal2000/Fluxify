import z from "zod";

/** How a call reached the admin API. Decided at sign-in, see `lib/bearerAuth.ts`. */
export const AUDIT_SOURCES = ["portal", "pat", "agent", "mcp"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_ACTIONS = [
	"create",
	"update",
	"delete",
	"login",
	"test",
	"run",
	"commit",
	"checkout",
	"promote",
	"rotate",
	"connect",
	"disconnect",
	"copy",
] as const;

export type AuditActor = { actorId: string; actorEmail: string; source: AuditSource };

/**
 * One audited change. Holds property NAMES only, never values: nothing a
 * secret could ride in except `message`, which is scrubbed (`event.ts`).
 */
export const auditEventSchema = z.object({
	id: z.uuid(),
	ts: z.iso.datetime(),
	actorId: z.string().min(1).max(100),
	actorEmail: z.string().max(320),
	source: z.enum(AUDIT_SOURCES),
	/** null for instance-level events: login, instance settings, users */
	projectId: z.string().max(50).nullable(),
	/** snapshot at write time; the project may be gone by the time anyone reads it */
	projectName: z.string().max(200).nullable(),
	projectSlug: z.string().max(200).nullable(),
	resourceType: z.string().min(1).max(50),
	resourceId: z.string().max(100),
	action: z.string().min(1).max(50),
	changedFields: z.array(z.string().max(100)).max(200),
	status: z.enum(["success", "failure"]),
	message: z.string().max(500).optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Where batches of events land. Postgres today; a ClickHouse sink can replace it. */
export interface AuditSink {
	/** Must be idempotent on `event.id`: the broker redelivers. */
	insert(batch: AuditEvent[]): Promise<void>;
}

export type AuditRecordInput = {
	/**
	 * null/absent: an instance-level event, always recorded while the licence allows.
	 * A function is called only once the gate has passed, so a service that has to
	 * look the project up pays for it only when audit logs are on.
	 */
	projectId?: string | null | (() => Promise<string | null | undefined>);
	resourceType: string;
	resourceId: string;
	action: (typeof AUDIT_ACTIONS)[number] | (string & {});
	/** property names that changed; never values */
	changedFields: string[];
	/** only for errors or special cases the fields cannot say; scrubbed before it is stored */
	message?: string;
	status?: "success" | "failure";
	/** a job with no request has no actor in context, so it must pass one */
	actor?: AuditActor;
	/**
	 * Overrides the project lookup. For a project created in the same transaction
	 * (nothing committed to look up yet), one being deleted, and for the save
	 * that turns logging on.
	 */
	project?: { name?: string; slug?: string; enabled?: boolean };
};
