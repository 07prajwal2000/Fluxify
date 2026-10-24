import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";
import type { SQL } from "bun";
import type { Pool } from "mysql2";

type Row = { id: number; payload: unknown };
type Emit = (rows: Row[]) => Promise<void>;

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const BATCH_MIN = 1;
const BATCH_MAX = 1_000;

/**
 * Claim a batch, run it, mark it done, in one transaction. A worker killed
 * mid-run rolls the claim back and another worker reads the same rows again,
 * which is why delivery is at least once and `done` is set only after `emit`
 * resolved.
 */
async function pollPostgres(sql: SQL, table: string, limit: number, emit: Emit) {
	return sql.begin(async (tx) => {
		const rows = (await tx.unsafe(
			`SELECT id, payload FROM ${table} WHERE NOT done ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
		)) as Row[];
		if (!rows.length) return 0;
		await emit(rows);
		const ids = rows.map((row) => row.id);
		await tx.unsafe(
			`UPDATE ${table} SET done = true WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(", ")})`,
			ids,
		);
		return rows.length;
	});
}

async function pollMysql(pool: Pool, table: string, limit: number, emit: Emit) {
	const db = await pool.promise().getConnection();
	try {
		await db.beginTransaction();
		const [found] = await db.query(
			"SELECT id, payload FROM ?? WHERE NOT done ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED",
			[table, limit],
		);
		const rows = found as Row[];
		if (!rows.length) {
			await db.commit();
			return 0;
		}
		await emit(rows);
		await db.query("UPDATE ?? SET done = true WHERE id IN (?)", [table, rows.map((row) => row.id)]);
		await db.commit();
		return rows.length;
	} catch (error) {
		await db.rollback();
		throw error;
	} finally {
		db.release();
	}
}

/** a wait that wakes the moment the trigger is stopped */
function pause(signal: AbortSignal, ms: number) {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout>;
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

export default trigger({
	name: "fluxify-examples/integrations/orders",
	label: "New orders",
	description: "Reads rows a poll has not handled yet and starts the workflow for each batch.",
	icon: "./icons/orders.svg",
	permissions: { integrations: ["database"] },
	params: {
		database: param.integration({
			label: "Database",
			description: "A PostgreSQL or MySQL integration that holds the table.",
			kind: "database",
			variants: ["PostgreSQL", "MySQL"],
			required: true,
		}),
		table: param.string({
			label: "Table",
			description: "A table with id, payload and a boolean done column.",
			required: true,
			default: "orders",
		}),
		everySeconds: param.number({
			label: "Poll every (seconds)",
			default: 10,
		}),
		batchSize: param.number({
			label: "Rows per poll",
			description: "The most rows one workflow run receives.",
			default: 50,
		}),
	},
	async start(ctx) {
		const connection = await ctx.integrations.connection(ctx.params.database);
		const table = ctx.params.table;
		if (!TABLE_NAME.test(table)) throw new Error(`'${table}' is not a plain table name`);
		const limit = Math.max(BATCH_MIN, Math.min(BATCH_MAX, Math.floor(ctx.params.batchSize)));
		const everyMs = Math.max(1, ctx.params.everySeconds) * 1_000;
		const emit: Emit = (rows) => ctx.emit(rows);
		const poll =
			connection.variant === "PostgreSQL"
				? () => pollPostgres(connection.raw, table, limit, emit)
				: () => pollMysql(connection.raw, table, limit, emit);
		const loop = (async () => {
			while (!ctx.signal.aborted) {
				const handled = await poll().catch((error) => {
					// the claim rolled back, so the rows stay for the next poll
					ctx.logger.logError(error);
					return 0;
				});
				if (handled < limit) await pause(ctx.signal, everyMs);
			}
		})().catch((error) => ctx.fail(error));
		return async () => {
			await loop;
		};
	},
});
