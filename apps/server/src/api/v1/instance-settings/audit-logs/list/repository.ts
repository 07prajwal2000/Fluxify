import { inArray } from "drizzle-orm";
import { db } from "../../../../../db";
import { auditEventsEntity, projectsEntity } from "../../../../../db/schema";
import { olap } from "../../../../../modules/olap";
import { chListAudit } from "../../../../../modules/olap/audit";
import { type AuditCursor, type AuditFilters, auditOrder, auditWhere } from "./query";

export const listAuditEvents = (
	filters: AuditFilters,
	after: AuditCursor | undefined,
	take: number,
) => {
	const ch = olap();
	if (ch) return chListAudit(ch, filters, after, take);
	return db
		.select()
		.from(auditEventsEntity)
		.where(auditWhere(filters, after))
		.orderBy(...auditOrder)
		.limit(take);
};

/** Which of these project ids still exist. One query for a whole page. */
export async function existingProjectIds(ids: string[]) {
	if (!ids.length) return new Set<string>();
	const rows = await db
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(inArray(projectsEntity.id, ids));
	return new Set(rows.map((r) => r.id));
}
