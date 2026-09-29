import { CompiledQuery, Kysely, MysqlDialect, sql } from "kysely";
import { createPool, type Pool } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import {
	bulkChunkSize,
	type Connection,
	changedRows,
	conflictKeys,
	conflictUpdateColumns,
	type DBConditionType,
	DbAdapterMode,
	groupIntrospectionRows,
	type IDbAdapter,
	type IntrospectedTable,
	type OnConflict,
	sqlCounterSet,
	upsertRows,
	type WriteResult,
} from ".";
import { applySqlConditions } from "./conditions";
import { cursorSorts, type DbCursor, type DbPage, sqlPage } from "./cursor";
import { applyColumns, applyJoins, buildQualifiers, type QueryOptions } from "./jsonPath";
import { activeSorts, applySqlSort, type DbSort, singleRow, withTiebreaker } from "./sort";

// A generic schema to satisfy Kysely's strict typing without using 'any'
type FluxifyDatabase = Record<string, Record<string, any>>;

const INTROSPECT_SQL = `
	SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
	       c.COLUMN_TYPE AS data_type, k.REFERENCED_TABLE_NAME AS ref_table
	FROM information_schema.COLUMNS c
	LEFT JOIN information_schema.KEY_COLUMN_USAGE k
	  ON k.TABLE_SCHEMA = c.TABLE_SCHEMA
	 AND k.TABLE_NAME = c.TABLE_NAME
	 AND k.COLUMN_NAME = c.COLUMN_NAME
	 AND k.REFERENCED_TABLE_NAME IS NOT NULL
	WHERE c.TABLE_SCHEMA = DATABASE()
	ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
`;

const PRIMARY_KEY_SQL = `
	SELECT COLUMN_NAME AS column_name FROM information_schema.KEY_COLUMN_USAGE
	WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
	ORDER BY ORDINAL_POSITION
`;

type Row = Record<string, any>;

export class MySqlAdapter implements IDbAdapter {
	public static variant = "MySQL";
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;

	private reservedConn: PoolConnection | null = null;
	private originalRelease: (() => void) | null = null;
	private transactionDb: Kysely<FluxifyDatabase> | null = null;
	// ponytail: never invalidated, a PK altered at runtime needs a new adapter
	private readonly primaryKeys = new Map<string, string[]>();

	constructor(
		private readonly db: Kysely<FluxifyDatabase>,
		private readonly pool: Pool,
	) {}

	public static createPool(connection: Connection): Pool {
		return createPool(buildMysqlUrl(connection));
	}

	public static createKysely(pool: Pool): Kysely<FluxifyDatabase> {
		return new Kysely<FluxifyDatabase>({
			dialect: new MysqlDialect({
				pool,
				// #512: TIMESTAMP reads back in UTC whatever the server's time zone
				onCreateConnection: async (conn) => {
					await conn.executeQuery(CompiledQuery.raw("SET time_zone = '+00:00'"));
				},
			}),
		});
	}

	public static async testConnection(
		connection: Connection,
	): Promise<{ success: boolean; error?: any }> {
		let tempPool: Pool | null = null;
		try {
			tempPool = createPool(buildMysqlUrl(connection));
			const [rows] = await tempPool.promise().query("SELECT 1 AS test");

			// Strictly type the rows output
			const resultRows = rows as Array<Record<string, any>>;
			return { success: resultRows[0]?.test == 1 };
		} catch (error) {
			return { success: false, error };
		} finally {
			if (tempPool) {
				await tempPool.promise().end();
			}
		}
	}

	async raw(query: string | any, params?: any[]): Promise<any> {
		if (typeof query !== "string") throw new Error("raw() accepts only string queries.");

		const conn = this.getConnection();
		// rows only: the full result carries a BigInt `numAffectedRows` that JSON cannot serialize
		const result = await conn.executeQuery(CompiledQuery.raw(query, params ?? []));
		return result.rows;
	}

	async introspect(): Promise<IntrospectedTable[]> {
		return groupIntrospectionRows(await this.raw(INTROSPECT_SQL));
	}

	async getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		offset: number = 0,
		sort: DbSort[] = [],
		options?: QueryOptions,
	): Promise<any[]> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins);
		qb = this.buildQuery(conditions, qb, qualifiers);

		const sorts = await this.withKeys(activeSorts(sort), table, options);

		// MySQL has no OFFSET without LIMIT; its docs give the largest one for "no limit"
		const q = applyColumns(qb, options?.columns)
			.limit(limit ?? sql<number>`18446744073709551615`)
			.offset(offset);
		return applySqlSort(q, sorts, "mysql", qualifiers).execute();
	}

	async getPage(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		sort: DbSort[],
		cursor: DbCursor,
		options?: QueryOptions,
	): Promise<DbPage> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins);
		qb = this.buildQuery(conditions, qb, qualifiers);
		const sorts = cursorSorts(
			activeSorts(sort),
			cursor.keys,
			await this.primaryKey(table),
			table,
			!!options?.joins?.length,
		);
		return sqlPage(qb, sorts, limit, cursor.after, options?.columns, "mysql", qualifiers);
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<any | null> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins);
		qb = this.buildQuery(conditions, qb, qualifiers);
		// unsorted stays unsorted: an ORDER BY nobody asked for only costs time
		const given = activeSorts(options?.sort);
		const sorts = given.length ? await this.withKeys(given, table, options) : [];
		// strict reads a second row only to tell that there is one
		const rows = await applySqlSort(
			applyColumns(qb, options?.columns).limit(options?.strict ? 2 : 1),
			sorts,
			"mysql",
			qualifiers,
		).execute();
		return singleRow(rows, options?.strict);
	}

	/** the sorts plus the primary key as the last tiebreaker */
	private async withKeys(sorts: DbSort[], table: string, options?: QueryOptions) {
		return withTiebreaker(sorts, await this.primaryKey(table), table, !!options?.joins?.length);
	}

	async count(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<number> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins);
		qb = this.buildQuery(conditions, qb, qualifiers);
		const row = await qb.select((eb) => eb.fn.countAll().as("count")).executeTakeFirst();
		// COUNT(*) comes back as a bigint string
		return Number(row?.count ?? 0);
	}

	/** MySQL has no RETURNING: lock and read the matching rows, then delete exactly those */
	async delete(table: string, conditions: DBConditionType[]): Promise<WriteResult> {
		const pk = await this.primaryKey(table);
		return this.withTransaction(async (trx) => {
			const affected: Row[] = await this.buildQuery(
				conditions,
				trx.selectFrom(table as never).selectAll(),
			)
				.forUpdate()
				.execute();
			if (affected.length === 0) return { count: 0, affected };
			// no key to delete by: re-run the conditions, the rows are locked
			const qb = trx.deleteFrom(table as never);
			const result = await (pk.length
				? whereKeys(qb, pk, affected)
				: this.buildQuery(conditions, qb)
			).executeTakeFirst();
			return { count: Number(result.numDeletedRows), affected };
		});
	}

	async insert(table: string, data: any, onConflict?: OnConflict): Promise<any> {
		const conn = this.getConnection();
		if (onConflict) {
			const { rows, counters } = upsertRows([data], onConflict);
			return (await this.upsert(conn, table, rows, counters, onConflict))[0] ?? null;
		}
		const result = await conn
			.insertInto(table as never)
			.values(data as never)
			.executeTakeFirst();
		const [row] = await this.readInserted(conn, table, [data], result?.insertId);
		return row ?? null;
	}

	async insertBulk(
		table: string,
		data: Record<string, any>[],
		useTransaction = false,
		onConflict?: OnConflict,
	): Promise<any[]> {
		if (!data || data.length === 0) return [];

		const { rows, counters } = upsertRows(data, onConflict);
		const insertChunks = async (conn: Kysely<FluxifyDatabase>) => {
			const chunkSize = bulkChunkSize(rows);
			const results: any[] = [];
			for (let i = 0; i < rows.length; i += chunkSize) {
				const chunk = rows.slice(i, i + chunkSize);
				if (onConflict) {
					results.push(...(await this.upsert(conn, table, chunk, counters, onConflict)));
					continue;
				}
				const result = await conn
					.insertInto(table as never)
					.values(chunk as never)
					.executeTakeFirst();
				results.push(...(await this.readInserted(conn, table, chunk, result?.insertId)));
			}
			return results;
		};

		// cache the key first: looked up inside the transaction, it takes a second pooled
		// connection, and parallel bulk inserts on a small pool then wait on each other forever
		await this.primaryKey(table);
		return useTransaction ? this.withTransaction(insertChunks) : insertChunks(this.getConnection());
	}

	async update(table: string, data: any, conditions: DBConditionType[]): Promise<WriteResult> {
		const pk = await this.primaryKey(table);
		const set = sqlCounterSet(data) as never;
		// MySQL has no RETURNING: lock the matching rows, update exactly those, re-read them
		return this.withTransaction(async (trx) => {
			const before: Row[] = await this.buildQuery(
				conditions,
				trx.selectFrom(table as never).selectAll(),
			)
				.forUpdate()
				.execute();
			if (before.length === 0) return { count: 0, affected: [] };

			if (pk.length === 0) {
				// ponytail: no key to pair rows before/after, so every re-read row counts as affected
				const result = await this.buildQuery(
					conditions,
					trx.updateTable(table as never).set(set),
				).executeTakeFirst();
				const count = Number(result.numChangedRows ?? 0);
				const after = count
					? await this.buildQuery(conditions, trx.selectFrom(table as never))
							.selectAll()
							.execute()
					: [];
				return { count, affected: after };
			}

			const result = await whereKeys(
				trx.updateTable(table as never).set(set),
				pk,
				before,
			).executeTakeFirst();

			// an update that sets a key column moves the row to that key
			const keyOf = (row: Row) => JSON.stringify(pk.map((c) => row[c]));
			const newKeys = before.map((k) =>
				Object.fromEntries(pk.map((c) => [c, c in data ? data[c] : k[c]])),
			);
			const was = new Map(before.map((row, i) => [keyOf(newKeys[i]), row]));
			const after: Row[] = await whereKeys(
				trx.selectFrom(table as never).selectAll(),
				pk,
				newKeys,
			).execute();
			// a row not found under its new key had a key column change
			return {
				count: Number(result.numChangedRows ?? 0),
				affected: changedRows(was, after, keyOf),
			};
		});
	}

	/**
	 * INSERT ... ON DUPLICATE KEY UPDATE, then re-read by `target`: MySQL matches on any unique
	 * key and has no RETURNING, so `target` is what finds the rows again. `ignore` sets a column
	 * to itself instead of INSERT IGNORE, which would also swallow FK and truncation errors, and
	 * reads the existing keys first to leave the skipped rows out.
	 */
	private async upsert(
		conn: Kysely<FluxifyDatabase>,
		table: string,
		rows: Row[],
		counters: string[],
		onConflict: OnConflict,
	): Promise<any[]> {
		const { target } = onConflict;
		const keys = conflictKeys(rows, target);
		const keyOf = (row: Row) => JSON.stringify(target.map((c) => row[c]));

		// ponytail: unlocked read, a duplicate another request inserts in between is reported as
		// inserted. FOR UPDATE would close that, but its gap locks deadlock concurrent upserts.
		const existing =
			onConflict.action === "ignore"
				? new Set(
						(
							await whereKeys(
								conn.selectFrom(table as never).select(target as never),
								target,
								keys,
							).execute()
						).map(keyOf),
					)
				: undefined;

		const columns = existing ? [] : conflictUpdateColumns(rows, onConflict);
		const set = columns.length
			? Object.fromEntries(
					columns.map((c) => [
						c,
						counters.includes(c)
							? sql`${sql.ref(c)} + values(${sql.ref(c)})`
							: sql`values(${sql.ref(c)})`,
					]),
				)
			: { [target[0]]: sql.ref(target[0]) };
		await conn
			.insertInto(table as never)
			.values(rows as never)
			.onDuplicateKeyUpdate(set as never)
			.execute();

		// both key sets come from the database, so types and collation agree
		const result: Row[] = await whereKeys(
			conn.selectFrom(table as never).selectAll(),
			target,
			keys,
		).execute();
		return existing ? result.filter((row) => !existing.has(keyOf(row))) : result;
	}

	/** Re-reads inserted rows by their primary key: the value supplied in the data, else the auto-increment id. */
	private async readInserted(
		conn: Kysely<FluxifyDatabase>,
		table: string,
		rows: Row[],
		insertId: bigint | undefined,
	): Promise<any[]> {
		const pk = await this.primaryKey(table);
		if (pk.length === 0) return [];

		// multi-row inserts get consecutive auto-increment ids, starting at insertId
		let nextId = insertId === undefined ? undefined : Number(insertId);
		const keys: Row[] = [];
		for (const row of rows) {
			const key = Object.fromEntries(pk.map((c) => [c, row[c]]));
			const missing = pk.filter((c) => key[c] == null);
			if (missing.length === 1 && pk.length === 1 && nextId !== undefined) key[pk[0]] = nextId++;
			else if (missing.length > 0) continue;
			keys.push(key);
		}
		if (keys.length === 0) return [];
		return whereKeys(conn.selectFrom(table as never).selectAll(), pk, keys).execute();
	}

	private async primaryKey(table: string): Promise<string[]> {
		let pk = this.primaryKeys.get(table);
		if (!pk) {
			const rows: Row[] = await this.raw(PRIMARY_KEY_SQL, [table]);
			pk = rows.map((r) => r.column_name);
			this.primaryKeys.set(table, pk);
		}
		return pk;
	}

	/** Runs `fn` in the open transaction, or in a new one. Never BEGIN inside an open one: MySQL commits it. */
	private withTransaction<T>(fn: (trx: Kysely<FluxifyDatabase>) => Promise<T>): Promise<T> {
		if (this.mode === DbAdapterMode.TRANSACTION && this.transactionDb)
			return fn(this.transactionDb);
		return this.db.transaction().execute(fn);
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;

		this.reservedConn = await this.pool.promise().getConnection();
		await this.reservedConn.beginTransaction();

		// Safely extract the raw callback connection without using 'any'
		const rawConn = (this.reservedConn as any as { connection: PoolConnection }).connection;

		this.originalRelease = rawConn.release.bind(rawConn);
		rawConn.release = () => {};

		this.transactionDb = new Kysely<FluxifyDatabase>({
			dialect: new MysqlDialect({
				pool: {
					getConnection: (cb: (err: any, conn: any) => void) => cb(null, rawConn),
				} as any as Pool,
			}),
		});

		await this.setMode(DbAdapterMode.TRANSACTION);
	}

	async commitTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
			throw new Error("Not in transaction mode");

		try {
			await this.reservedConn.commit();
		} finally {
			this.cleanupTransaction();
		}
	}

	async rollbackTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
			throw new Error("Not in transaction mode");

		try {
			await this.reservedConn.rollback();
		} finally {
			this.cleanupTransaction();
		}
	}

	private async cleanupTransaction() {
		if (this.reservedConn && this.originalRelease) {
			const rawConn = (this.reservedConn as any as { connection: PoolConnection }).connection;
			rawConn.release = this.originalRelease;
			this.reservedConn.release();
		}
		this.reservedConn = null;
		this.originalRelease = null;
		this.transactionDb = null;
		await this.setMode(DbAdapterMode.NORMAL);
	}

	private getConnection(): Kysely<FluxifyDatabase> {
		return this.mode === DbAdapterMode.TRANSACTION && this.transactionDb
			? this.transactionDb
			: this.db;
	}

	private buildQuery<B extends { where: Function }>(
		conditions: DBConditionType[],
		builder: B,
		qualifiers?: Set<string>,
	): B {
		return applySqlConditions(builder, conditions, "mysql", qualifiers);
	}
}

/** WHERE (k1 = ? AND k2 = ?) OR (...) for each key row; works for single and composite keys. */
function whereKeys<B extends { where: Function }>(qb: B, pk: string[], keys: Row[]): B {
	return qb.where((eb: any) =>
		eb.or(keys.map((k) => eb.and(pk.map((c) => eb(c, "=", k[c]))))),
	) as B;
}

/**
 * #512: BIGINT is a number while it's exact, otherwise text (never silently rounded);
 * DECIMAL stays text; DATETIME is read and written as UTC, not the server process's zone.
 */
export const MYSQL_POOL_OPTIONS = { supportBigNumbers: true, timezone: "Z" } as const;

export function buildMysqlUrl(connection: Connection): string {
	const { username, password, host, port, database } = connection;
	return `mysql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function extractMysqlConnectionInfo(
	config: Record<string, any>,
	appConfigs: Map<string, string>,
	mysqlUrlParser: (url: string) => Connection | null,
) {
	if (config.source === "url") {
		let urlStr = String(config.url);
		urlStr = urlStr.startsWith("cfg:") ? (appConfigs.get(urlStr.slice(4)) ?? "") : urlStr;

		const result = mysqlUrlParser(urlStr);
		if (result === null) return null;
		return {
			host: result.host,
			port: result.port,
			database: result.database,
			username: result.username,
			password: result.password,
			dbType: result.dbType,
		};
	}

	for (const key in config) {
		const value = String(config[key]);
		config[key] = value.startsWith("cfg:") ? (appConfigs.get(value.slice(4)) ?? "") : value;
	}
	return config;
}
