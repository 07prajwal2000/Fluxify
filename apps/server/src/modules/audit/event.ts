import { currentAuditContext, SYSTEM_ACTOR } from "./context";
import type { AuditActor, AuditEvent, AuditRecordInput } from "./types";

/** A property name: dotted, bracketed or hyphenated, never a sentence or a value. */
const FIELD_NAME = /^[\w.[\]:-]{1,100}$/;
const MESSAGE_MAX = 500;

/**
 * Things that look like a credential inside free text. A deny-list can never be
 * complete, which is why callers should keep secrets out of `message` in the
 * first place; this is the backstop.
 */
const SECRET_PATTERNS: RegExp[] = [
	/\b(?:flx|fxa)_[A-Za-z0-9_-]{8,}/g,
	/\bBearer\s+\S+/gi,
	/\b(?:password|passwd|pwd|secret|token|api[-_]?key|authorization|credentials?)\b\s*[:=]\s*\S+/gi,
	// user:password@host in a connection string
	/\/\/[^\s/:@]+:[^\s/@]+@/g,
	// long opaque strings: keys, JWTs, hashes
	/\b[A-Za-z0-9_+/=-]{32,}\b/g,
];

export function scrubMessage(message: string): string {
	let out = message;
	for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
	return out.length > MESSAGE_MAX ? `${out.slice(0, MESSAGE_MAX - 1)}…` : out;
}

/** Keeps what looks like a property name; drops anything that could be a value. */
export function sanitizeFields(fields: readonly string[]): string[] {
	return [...new Set(fields.filter((f) => FIELD_NAME.test(f)))].sort().slice(0, 200);
}

const emails = new Map<string, string>();

/** An agent run knows its user id only; the email is read once and kept. */
async function emailOf(userId: string): Promise<string> {
	const hit = emails.get(userId);
	if (hit !== undefined) return hit;
	const { eq } = await import("drizzle-orm");
	const { db } = await import("../../db");
	const { user } = await import("../../db/auth-schema");
	const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
	emails.set(userId, row?.email ?? "");
	return row?.email ?? "";
}

/** The actor in context, or the explicit one, or an error: an anonymous change is a bug. */
export async function resolveActor(explicit?: AuditActor): Promise<AuditActor> {
	if (explicit) {
		return { ...explicit, actorEmail: explicit.actorEmail || (await emailOf(explicit.actorId)) };
	}
	const context = currentAuditContext();
	if (!context) throw new Error("audit.record: no request context, pass `actor` explicitly");
	const actor = context.actor ?? SYSTEM_ACTOR;
	const actorEmail = actor.actorEmail || (await emailOf(actor.actorId));
	return { actorId: actor.actorId, actorEmail, source: context.source };
}

export function buildEvent(
	input: AuditRecordInput,
	project: { name: string; slug: string } | null,
	actor: AuditActor,
	projectId: string | null,
): AuditEvent {
	return {
		id: Bun.randomUUIDv7(),
		ts: new Date().toISOString(),
		...actor,
		projectId,
		projectName: project?.name ?? null,
		projectSlug: project?.slug ?? null,
		resourceType: input.resourceType,
		resourceId: input.resourceId,
		action: input.action,
		changedFields: sanitizeFields(input.changedFields),
		status: input.status ?? "success",
		...(input.message ? { message: scrubMessage(input.message) } : {}),
	};
}
