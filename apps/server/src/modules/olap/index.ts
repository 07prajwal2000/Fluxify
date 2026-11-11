import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { logger } from "@fluxify/common";
import { canUseOlap, olapRefusal } from "../../lib/edition";
import {
	AUDIT_LOG_MAX_AGE_DAYS,
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER,
	OLAP_BACKEND,
	RECORDING_MAX_AGE_DAYS,
} from "../../lib/env";
import { olapSchema } from "./schema";

/**
 * The OLAP backend (#760): where append-only observability data lives —
 * recordings (runs and spans), `runtime` / `ephemeral` system logs and audit
 * events. `null` means Postgres, the default. Upserted system logs (compile,
 * orchestrator) always stay in Postgres: ClickHouse has no cheap upsert.
 *
 * Chosen once, at admin boot. Workers never touch it.
 */
let client: ClickHouseClient | null = null;

export const olap = () => client;

/** tests: point the stores at a container */
export const setOlapClient = (c: ClickHouseClient | null) => {
	client = c;
};

const settings = {
	date_time_input_format: "best_effort",
	output_format_json_quote_64bit_integers: 0,
} as const;

export function connectClickhouse(url: string, database?: string) {
	return createClient({
		url,
		username: CLICKHOUSE_USER,
		password: CLICKHOUSE_PASSWORD,
		database,
		clickhouse_settings: settings,
	});
}

/** Creates the database and tables if missing, and applies the current retention as TTL. */
export async function migrateClickhouse(url: string, database: string) {
	const root = connectClickhouse(url);
	try {
		await root.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
	} finally {
		await root.close();
	}
	const c = connectClickhouse(url, database);
	for (const query of olapSchema(RECORDING_MAX_AGE_DAYS, AUDIT_LOG_MAX_AGE_DAYS)) {
		await c.command({ query });
	}
	return c;
}

/**
 * Admin boot, after the licence is published. Unlicensed falls back to Postgres
 * with a warning; licensed but unreachable refuses to boot — the operator asked
 * for ClickHouse, and silently writing elsewhere would split their data.
 */
export async function initOlap() {
	if (OLAP_BACKEND !== "clickhouse") return;
	if (!canUseOlap()) {
		logger.warn(`OLAP_BACKEND=clickhouse ignored: ${olapRefusal()}. Using Postgres.`, "OLAP");
		return;
	}
	try {
		if (!CLICKHOUSE_URL) throw new Error("CLICKHOUSE_URL is not set");
		const c = await migrateClickhouse(CLICKHOUSE_URL, CLICKHOUSE_DATABASE);
		const ping = await c.ping();
		if (!ping.success) throw ping.error;
		client = c;
		logger.info(`observability data stored in ClickHouse (${CLICKHOUSE_DATABASE})`, "OLAP");
	} catch (error) {
		logger.error(
			`FATAL: OLAP_BACKEND=clickhouse but ClickHouse is unavailable: ${String(error)}`,
			"OLAP",
		);
		process.exit(1);
	}
}

/** `DateTime64` comes back as `YYYY-MM-DD hh:mm:ss.sss` in UTC */
export const chDate = (v: string) => new Date(`${v.replace(" ", "T")}Z`);
export const chDateOrNull = (v: string | null) => (v ? chDate(v) : null);
export const chJson = <T = unknown>(v: string | null): T | null =>
	v == null ? null : JSON.parse(v);
export const toJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/** one JSONEachRow query */
export async function chRows<T>(c: ClickHouseClient, query: string, query_params?: object) {
	// unset filters are left out of the query text, so their params are dropped too
	const params = Object.fromEntries(
		Object.entries(query_params ?? {}).filter(([, v]) => v !== undefined),
	);
	const rs = await c.query({ query, query_params: params, format: "JSONEachRow" });
	return rs.json<T>();
}
