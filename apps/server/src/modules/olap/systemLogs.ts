import type { ClickHouseClient } from "@clickhouse/client";
import { chDate, chJson, chRows, toJson } from "./index";

/** `runtime` / `ephemeral` system logs in ClickHouse (#760): append-only, aged out by TTL. */

export type OlapLogRow = {
	projectId?: string | null;
	resourceType: string;
	resourceId: string;
	type: string;
	level: "info" | "warn" | "error";
	message: string;
	detail: Record<string, unknown> | null;
	runId?: string;
};

// ponytail: time-based id (µs-ish + jitter), unique enough for UI keys; no sequence in ClickHouse
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

export async function chWriteLog(c: ClickHouseClient, row: OlapLogRow) {
	await c.insert({
		table: "system_logs",
		format: "JSONEachRow",
		values: [
			{
				id: newId(),
				project_id: row.projectId ?? "",
				resource_type: row.resourceType,
				resource_id: row.resourceId,
				type: row.type,
				level: row.level,
				message: row.message,
				detail: toJson(row.detail),
				run_id: row.runId ?? null,
				updated_at: new Date().toISOString(),
			},
		],
	});
}

export type OlapLogFilter = {
	projectId: string;
	resourceType?: string;
	resourceId?: string;
	type?: string;
	level?: string;
	env?: string;
	limit: number;
	userId: string;
	/** the viewer's sandboxes: a sandbox's logs are its owner's alone (#735) */
	sandboxIds: string[];
};

type Out = {
	id: number;
	project_id: string;
	resource_type: string;
	resource_id: string;
	type: string;
	level: "info" | "warn" | "error";
	message: string;
	detail: string | null;
	run_id: string | null;
	updated_at: string;
};

const detail = (key: string) => `JSONExtractString(ifNull(detail, ''), '${key}')`;

export async function chListLogs(c: ClickHouseClient, f: OlapLogFilter) {
	const where = [
		"project_id = {p:String}",
		"(resource_type != 'sandbox' OR resource_id IN {sb:Array(String)})",
		`(type != 'ephemeral' OR ${detail("userId")} = {u:String})`,
	];
	if (f.resourceType) where.push("resource_type = {rt:String}");
	if (f.resourceId) where.push("resource_id = {rid:String}");
	if (f.type) where.push("type = {type:String}");
	if (f.level) where.push("level = {level:String}");
	if (f.env) where.push(`(${detail("env")} = '' OR ${detail("env")} = {env:String})`);
	const rows = await chRows<Out>(
		c,
		`SELECT * FROM system_logs WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT {limit:UInt32}`,
		{
			p: f.projectId,
			sb: f.sandboxIds,
			u: f.userId,
			rt: f.resourceType,
			rid: f.resourceId,
			type: f.type,
			level: f.level,
			env: f.env,
			limit: f.limit,
		},
	);
	return rows.map((r) => ({
		id: r.id,
		projectId: r.project_id || null,
		resourceType: r.resource_type,
		resourceId: r.resource_id,
		type: r.type,
		level: r.level,
		message: r.message,
		detail: chJson<Record<string, unknown>>(r.detail),
		runId: r.run_id,
		updatedAt: chDate(r.updated_at),
	}));
}
