import type { ClickHouseClient } from "@clickhouse/client";
import type { TraceRunMetadata, TraceSpanMetadata } from "@fluxify/common/otlp";
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { canvasVersionsEntity } from "../../db/schema";
import { chDate, chDateOrNull, chJson, chRows, toJson } from "./index";

/** Recordings in ClickHouse (#760). Same shapes the Postgres repositories return. */

type Target = { type: "route" | "workflow" | "sandbox"; id: string };
const targetColumn = (t: Target) => `${t.type}_id`; // fixed set, never user text

export type RunRow = {
	id: string;
	projectId: string;
	routeId?: string;
	workflowId?: string;
	sandboxId?: string;
	routeVersion?: string;
	workflowVersion?: string;
	versionId: string | null;
	startedAt: Date;
	endedAt: Date;
	outcome: "success" | "failure" | "cancelled";
	statusCode?: number;
	truncated: boolean;
	droppedSpans: number;
	parentRunId?: string;
	parentSeq?: number;
	spanCount: number;
	metadata?: TraceRunMetadata;
	env: "production" | "development";
};

export type SpanRow = {
	runId: string;
	seq: number;
	parentSeq?: number;
	blockId: string;
	blockType: string;
	blockName?: string;
	customBlockId?: string;
	middleware?: unknown;
	startedAt: Date;
	endedAt: Date;
	outcome: "success" | "failure";
	branch?: "success" | "failure";
	error?: string;
	input?: unknown;
	output?: unknown;
	truncated: boolean;
	metadata?: TraceSpanMetadata;
};

/**
 * Spans first, run last, so a run that is visible has its spans. Not atomic: a
 * failure retries the message and the engine collapses the repeated rows.
 * Returns whether the run is new, so a redelivery logs no second failure.
 */
export async function chInsertRecording(c: ClickHouseClient, run: RunRow, spans: SpanRow[]) {
	const seen = await chRows(
		c,
		"SELECT 1 FROM trace_runs WHERE project_id = {p:String} AND id = {id:UUID} LIMIT 1",
		{
			p: run.projectId,
			id: run.id,
		},
	);
	if (spans.length) {
		await c.insert({
			table: "trace_spans",
			format: "JSONEachRow",
			values: spans.map((s) => ({
				run_id: s.runId,
				seq: s.seq,
				parent_seq: s.parentSeq ?? null,
				block_id: s.blockId,
				block_type: s.blockType,
				block_name: s.blockName ?? null,
				custom_block_id: s.customBlockId ?? null,
				middleware: toJson(s.middleware),
				started_at: s.startedAt.toISOString(),
				ended_at: s.endedAt.toISOString(),
				outcome: s.outcome,
				branch: s.branch ?? null,
				error: s.error ?? null,
				input: toJson(s.input),
				output: toJson(s.output),
				truncated: s.truncated,
				metadata: toJson(s.metadata),
			})),
		});
	}
	await c.insert({
		table: "trace_runs",
		format: "JSONEachRow",
		values: [
			{
				id: run.id,
				project_id: run.projectId,
				route_id: run.routeId ?? null,
				workflow_id: run.workflowId ?? null,
				sandbox_id: run.sandboxId ?? null,
				route_version: run.routeVersion ?? null,
				workflow_version: run.workflowVersion ?? null,
				version_id: run.versionId,
				started_at: run.startedAt.toISOString(),
				ended_at: run.endedAt.toISOString(),
				outcome: run.outcome,
				status_code: run.statusCode ?? null,
				truncated: run.truncated,
				dropped_spans: run.droppedSpans,
				parent_run_id: run.parentRunId ?? null,
				parent_seq: run.parentSeq ?? null,
				span_count: run.spanCount,
				metadata: toJson(run.metadata),
				env: run.env,
			},
		],
	});
	return seen.length === 0;
}

type RunHeader = {
	id: string;
	outcome: "success" | "failure" | "cancelled";
	status_code: number | null;
	started_at: string;
	ended_at: string | null;
	span_count: number;
	truncated: boolean;
	dropped_spans: number;
	parent_run_id: string | null;
	parent_seq: number | null;
	env: "production" | "development";
	version_id: string | null;
	metadata: string | null;
};

const HEADER = `id, outcome, status_code, started_at, ended_at, span_count, truncated, dropped_spans,
	parent_run_id, parent_seq, env, version_id, metadata`;

/** canvas versions live in Postgres; one lookup per page */
async function versionNumbers(ids: (string | null)[]) {
	const wanted = [...new Set(ids.filter((v): v is string => Boolean(v)))];
	if (!wanted.length) return new Map<string, number>();
	const rows = await db
		.select({ id: canvasVersionsEntity.id, n: canvasVersionsEntity.versionNumber })
		.from(canvasVersionsEntity)
		.where(inArray(canvasVersionsEntity.id, wanted));
	return new Map(rows.map((r) => [r.id, r.n]));
}

async function toHeaders(rows: RunHeader[]) {
	const versions = await versionNumbers(rows.map((r) => r.version_id));
	return rows.map((r) => ({
		id: r.id,
		outcome: r.outcome,
		statusCode: r.status_code,
		startedAt: chDate(r.started_at),
		endedAt: chDateOrNull(r.ended_at),
		spanCount: r.span_count,
		truncated: r.truncated,
		droppedSpans: r.dropped_spans,
		parentRunId: r.parent_run_id,
		parentSeq: r.parent_seq,
		env: r.env,
		versionId: r.version_id,
		versionNumber: r.version_id ? (versions.get(r.version_id) ?? null) : null,
		// biome-ignore lint/suspicious/noExplicitAny: same jsonb shape Postgres hands back
		metadata: chJson<any>(r.metadata),
	}));
}

const meta = (key: string) => `JSONExtractString(ifNull(metadata, ''), '${key}')`;

export type RunFilters = {
	outcome?: string;
	from?: Date;
	to?: Date;
	source?: "test" | "live";
	testRunId?: string;
	env?: string;
	versionId?: string;
	search?: string;
};

export async function chListRuns(
	c: ClickHouseClient,
	projectId: string,
	target: Target,
	f: RunFilters,
	skip: number,
	take: number,
) {
	const where = ["project_id = {p:String}", `${targetColumn(target)} = {t:String}`];
	const params: Record<string, unknown> = { p: projectId, t: target.id, skip, take };
	const add = (clause: string, key: string, value: unknown) => {
		where.push(clause);
		params[key] = value;
	};
	if (f.outcome) add("outcome = {outcome:String}", "outcome", f.outcome);
	if (f.env) add("env = {env:String}", "env", f.env);
	if (f.versionId) add("version_id = {v:UUID}", "v", f.versionId);
	if (f.from)
		add("started_at >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')", "from", f.from.getTime());
	if (f.to) add("started_at < fromUnixTimestamp64Milli({to:Int64}, 'UTC')", "to", f.to.getTime());
	if (f.testRunId) add(`${meta("testRunId")} = {tr:String}`, "tr", f.testRunId);
	else if (f.source === "test") where.push(`${meta("source")} = 'test'`);
	else if (f.source === "live") where.push(`${meta("source")} != 'test'`);
	if (f.search)
		add(
			`(toString(status_code) ILIKE {q:String} OR toString(id) ILIKE {q:String} OR ${meta("label")} ILIKE {q:String}
				OR ${meta("suiteName")} ILIKE {q:String} OR ${meta("caseName")} ILIKE {q:String})`,
			"q",
			`%${f.search}%`,
		);
	const w = where.join(" AND ");
	const [rows, [total]] = await Promise.all([
		chRows<RunHeader>(
			c,
			`SELECT ${HEADER} FROM trace_runs FINAL WHERE ${w}
			ORDER BY started_at DESC, id DESC LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
			params,
		),
		chRows<{ n: number }>(c, `SELECT count() AS n FROM trace_runs FINAL WHERE ${w}`, params),
	]);
	return { result: await toHeaders(rows), totalCount: total?.n ?? 0 };
}

type SpanOut = {
	seq: number;
	parent_seq: number | null;
	block_id: string;
	block_type: string;
	block_name: string | null;
	custom_block_id: string | null;
	middleware: string | null;
	started_at: string;
	ended_at: string;
	outcome: "success" | "failure" | "cancelled";
	branch: "success" | "failure" | "cancelled" | null;
	error: string | null;
	input: string | null;
	output: string | null;
	truncated: boolean;
	metadata: string | null;
};

export async function chGetRun(
	c: ClickHouseClient,
	projectId: string,
	target: Target,
	runId: string,
	env?: string,
) {
	const params = { p: projectId, t: target.id, id: runId, env: env ?? "" };
	const [run] = await toHeaders(
		await chRows<RunHeader>(
			c,
			`SELECT ${HEADER} FROM trace_runs FINAL
			WHERE project_id = {p:String} AND ${targetColumn(target)} = {t:String} AND id = {id:UUID}
				AND ({env:String} = '' OR env = {env:String})`,
			params,
		),
	);
	if (!run) return null;
	const [spans, children] = await Promise.all([
		chRows<SpanOut>(
			c,
			"SELECT * FROM trace_spans FINAL WHERE run_id = {id:UUID} ORDER BY seq",
			params,
		),
		chRows<{ id: string; parent_seq: number | null }>(
			c,
			`SELECT id, parent_seq FROM trace_runs FINAL
			WHERE project_id = {p:String} AND parent_run_id = {id:UUID} ORDER BY started_at`,
			params,
		),
	]);
	return {
		...run,
		spans: spans.map((s) => ({
			seq: s.seq,
			parentSeq: s.parent_seq,
			blockId: s.block_id,
			blockType: s.block_type,
			blockName: s.block_name,
			customBlockId: s.custom_block_id,
			// biome-ignore lint/suspicious/noExplicitAny: same jsonb shape Postgres hands back
			middleware: chJson<any>(s.middleware),
			startedAt: chDate(s.started_at),
			endedAt: chDate(s.ended_at),
			outcome: s.outcome,
			branch: s.branch,
			error: s.error,
			input: chJson(s.input),
			output: chJson(s.output),
			truncated: s.truncated,
			// biome-ignore lint/suspicious/noExplicitAny: same jsonb shape Postgres hands back
			metadata: chJson<any>(s.metadata),
		})),
		childRuns: children.map((r) => ({ id: r.id, parentSeq: r.parent_seq })),
	};
}

/** Deletes the runs with their spans and `runtime` logs — the cascade Postgres does by FK. */
export async function chDeleteRuns(
	c: ClickHouseClient,
	projectId: string,
	target: Target,
	runId?: string,
) {
	const runs = `SELECT id FROM trace_runs WHERE project_id = {p:String} AND ${targetColumn(target)} = {t:String}
		AND ({id:String} = '' OR toString(id) = {id:String})`;
	const params = { p: projectId, t: target.id, id: runId ?? "" };
	const [found] = await chRows<{ n: number }>(
		c,
		`SELECT uniqExact(id) AS n FROM (${runs})`,
		params,
	);
	if (!found?.n) return 0;
	await c.command({
		query: `DELETE FROM trace_spans WHERE run_id IN (${runs})`,
		query_params: params,
	});
	await c.command({
		query: `DELETE FROM system_logs WHERE run_id IN (${runs})`,
		query_params: params,
	});
	await c.command({ query: `DELETE FROM trace_runs WHERE id IN (${runs})`, query_params: params });
	return found.n;
}

/** a test run's case traces (#627), found by the test run id in their metadata */
export async function chCaseTraces(c: ClickHouseClient, projectId: string, testRunId: string) {
	return chRows<{ traceRunId: string; suiteId: string; caseIndex: number }>(
		c,
		`SELECT id AS traceRunId, ${meta("suiteId")} AS suiteId, toInt32(JSONExtractInt(ifNull(metadata, ''), 'caseIndex')) AS caseIndex
		FROM trace_runs FINAL
		WHERE project_id = {p:String} AND ${meta("testRunId")} = {tr:String} AND parent_run_id IS NULL`,
		{ p: projectId, tr: testRunId },
	);
}
