import type z from "zod";
import type { auditEventsEntity } from "../../../../../db/schema";
import { assertCanReadAudit } from "../../../../../lib/edition";
import type { auditRowSchema, requestQuerySchema } from "./dto";
import { decodeCursor, encodeCursor } from "./query";
import { existingProjectIds, listAuditEvents } from "./repository";

type Row = typeof auditEventsEntity.$inferSelect;
type AuditRow = z.infer<typeof auditRowSchema>;

export const toAuditRow = (row: Row, existing: Set<string>): AuditRow => ({
	...row,
	ts: row.ts.toISOString(),
	source: row.source as AuditRow["source"],
	status: row.status as AuditRow["status"],
	projectDeleted: !!row.projectId && !existing.has(row.projectId),
});

export default async function handleRequest(query: z.infer<typeof requestQuerySchema>) {
	assertCanReadAudit();
	const { cursor, limit, ...filters } = query;
	// one extra row tells whether another page follows
	const rows = await listAuditEvents(filters, cursor ? decodeCursor(cursor) : undefined, limit + 1);
	const page = rows.slice(0, limit);
	const last = page.at(-1);
	const projectIds = [...new Set(page.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
	const existing = await existingProjectIds(projectIds);
	return {
		data: page.map((r) => toAuditRow(r, existing)),
		nextCursor: rows.length > limit && last ? encodeCursor(last.ts, last.id) : null,
	};
}
