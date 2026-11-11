import type { ClickHouseClient } from "@clickhouse/client";
import type { AuditEvent } from "../audit/types";
import { chDate, chRows } from "./index";

/** Audit events in ClickHouse (#760). Same shapes as the Postgres repositories. */

export async function chInsertAudit(c: ClickHouseClient, batch: AuditEvent[]) {
	await c.insert({
		table: "audit_events",
		format: "JSONEachRow",
		values: batch.map((e) => ({
			id: e.id,
			ts: new Date(e.ts).toISOString(),
			actor_id: e.actorId,
			actor_email: e.actorEmail,
			source: e.source,
			project_id: e.projectId ?? null,
			project_name: e.projectName ?? null,
			project_slug: e.projectSlug ?? null,
			resource_type: e.resourceType,
			resource_id: e.resourceId,
			action: e.action,
			changed_fields: e.changedFields,
			status: e.status,
			message: e.message ?? null,
		})),
	});
}

export type ChAuditFilters = {
	projectId?: string;
	actorId?: string;
	actorEmail?: string;
	resourceType?: string;
	action?: string;
	source?: string;
	resourceId?: string;
	from?: Date;
	to?: Date;
};

/** user text matched as plain text: `%` and `_` are not wildcards */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

type Out = {
	id: string;
	ts: string;
	actor_id: string;
	actor_email: string;
	source: string;
	project_id: string | null;
	project_name: string | null;
	project_slug: string | null;
	resource_type: string;
	resource_id: string;
	action: string;
	changed_fields: string[];
	status: string;
	message: string | null;
};

/** Newest first; "after" the cursor means a smaller (ts, id). */
export async function chListAudit(
	c: ClickHouseClient,
	f: ChAuditFilters,
	after: { ts: Date; id: string } | undefined,
	take: number,
) {
	const where: string[] = ["1"];
	if (f.projectId) where.push("project_id = {projectId:String}");
	if (f.actorId) where.push("actor_id = {actorId:String}");
	if (f.actorEmail) where.push("actor_email ILIKE {actorEmail:String}");
	if (f.resourceType) where.push("resource_type = {resourceType:String}");
	if (f.action) where.push("action = {action:String}");
	if (f.source) where.push("source = {source:String}");
	if (f.resourceId) where.push("resource_id ILIKE {resourceId:String}");
	if (f.from) where.push("ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')");
	if (f.to) where.push("ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')");
	if (after) where.push("(ts, id) < (fromUnixTimestamp64Milli({cts:Int64}, 'UTC'), {cid:UUID})");
	const rows = await chRows<Out>(
		c,
		`SELECT * FROM audit_events FINAL WHERE ${where.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT {take:UInt32}`,
		{
			...f,
			actorEmail: f.actorEmail && contains(f.actorEmail),
			resourceId: f.resourceId && contains(f.resourceId),
			from: f.from?.getTime(),
			to: f.to?.getTime(),
			cts: after?.ts.getTime(),
			cid: after?.id,
			take,
		},
	);
	return rows.map((r) => ({
		id: r.id,
		ts: chDate(r.ts),
		actorId: r.actor_id,
		actorEmail: r.actor_email,
		source: r.source,
		projectId: r.project_id,
		projectName: r.project_name,
		projectSlug: r.project_slug,
		resourceType: r.resource_type,
		resourceId: r.resource_id,
		action: r.action,
		changedFields: r.changed_fields,
		status: r.status,
		message: r.message,
	}));
}

export const chDistinct = async (c: ClickHouseClient, column: "resource_type" | "action") =>
	(
		await chRows<{ v: string }>(c, `SELECT DISTINCT ${column} AS v FROM audit_events ORDER BY v`)
	).map((r) => r.v);

/** one row per project that has events, named as its newest event named it */
export const chProjectsWithEvents = (c: ClickHouseClient) =>
	chRows<{ id: string; name: string | null; slug: string | null }>(
		c,
		`SELECT project_id AS id, argMax(project_name, ts) AS name, argMax(project_slug, ts) AS slug
		FROM audit_events WHERE project_id IS NOT NULL GROUP BY project_id`,
	);
