import { and, desc, gte, ilike, lt, type SQL, sql } from "drizzle-orm";
import z from "zod";
import { auditEventsEntity as t } from "../../../../../db/schema";
import { BadRequestError } from "../../../../../errors/badRequestError";
import type { requestQuerySchema } from "./dto";

export type AuditFilters = Omit<z.infer<typeof requestQuerySchema>, "cursor" | "limit">;
export type AuditCursor = { ts: Date; id: string };

/** Opaque to clients: the last row's (ts, id), the key the list is ordered by. */
export const encodeCursor = (ts: Date, id: string) =>
	Buffer.from(JSON.stringify([ts.toISOString(), id])).toString("base64url");

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

export function decodeCursor(cursor: string): AuditCursor {
	let parsed: ReturnType<typeof cursorSchema.safeParse> | undefined;
	try {
		parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
	} catch {}
	if (!parsed?.success) {
		throw new BadRequestError("cursor is not valid: pass back the nextCursor of the previous page");
	}
	return { ts: new Date(parsed.data[0]), id: parsed.data[1] };
}

/** user text matched as plain text: `%` and `_` are not wildcards */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** Every filter ANDed. The list runs newest first, so "after" the cursor means a smaller (ts, id). */
export function auditWhere(f: AuditFilters, after?: AuditCursor): SQL | undefined {
	return and(
		f.projectId ? sql`${t.projectId} = ${f.projectId}` : undefined,
		f.actorId ? sql`${t.actorId} = ${f.actorId}` : undefined,
		f.actorEmail ? ilike(t.actorEmail, contains(f.actorEmail)) : undefined,
		f.resourceType ? sql`${t.resourceType} = ${f.resourceType}` : undefined,
		f.action ? sql`${t.action} = ${f.action}` : undefined,
		f.source ? sql`${t.source} = ${f.source}` : undefined,
		f.resourceId ? ilike(t.resourceId, contains(f.resourceId)) : undefined,
		f.from ? gte(t.ts, f.from) : undefined,
		f.to ? lt(t.ts, f.to) : undefined,
		after
			? sql`(${t.ts}, ${t.id}) < (${after.ts.toISOString()}::timestamptz, ${after.id}::uuid)`
			: undefined,
	);
}

export const auditOrder = [desc(t.ts), desc(t.id)];
