import { SQL } from "bun";
import { CompiledQuery, type InsertQueryBuilder, Kysely, sql } from "kysely";
import {
	bulkChunkSize,
	type Connection,
	conflictUpdateColumns,
	type DBConditionType,
	DbAdapterMode,
	groupIntrospectionRows,
	type IDbAdapter,
	type IntrospectedTable,
	type IsolationLevel,
	isolationClause,
	type OnConflict,
	sqlCounterSet,
	upsertRows,
	type WriteResult,
} from ".";
import { applyJoins, applySqlConditions } from "./conditions";
import { cachedPrimaryKey } from "./connection";
import { cursorSorts, type DbCursor, type DbPage, sqlPage } from "./cursor";
import { applyColumns, buildQualifiers, type QueryOptions } from "./jsonPath";
import { BunSqlPostgresDialect } from "./kyselySqlDialect";
import { activeSorts, applySqlSort, type DbSort, singleRow, withTiebreaker } from "./sort";

export type FluxifyDatabase = Record<string, Record<string, any>>;

const INTROSPECT_SQL = `
	SELECT c.table_name, c.column_name, c.data_type, fk.ref_table
	FROM information_schema.columns c
	LEFT JOIN (
		SELECT kcu.table_schema, kcu.table_name, kcu.column_name,
		       ccu.table_name AS ref_table
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON kcu.constraint_name = tc.constraint_name
		 AND kcu.constraint_schema = tc.constraint_schema
		JOIN information_schema.constraint_column_usage ccu
		  ON ccu.constraint_name = tc.constraint_name
		 AND ccu.constraint_schema = tc.constraint_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
	) fk ON fk.table_schema = c.table_schema
	    AND fk.table_name = c.table_name
	    AND fk.column_name = c.column_name
	WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
	ORDER BY c.table_name, c.ordinal_position
`;

// to_regclass: a missing table (or a view) has no key rather than an error
const PRIMARY_KEY_SQL = `
	SELECT a.attname AS column_name
	FROM pg_index i
	JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
	WHERE i.indrelid = to_regclass($1) AND i.indisprimary
	ORDER BY array_position(i.indkey::int2[], a.attnum)
`;

/** a table name as to_regclass reads it: each part quoted, so case is kept like Kysely keeps it */
const regclassName = (table: string) =>
	table
		.split(".")
		.map((part) => `"${part.replaceAll('"', '""')}"`)
		.join(".");

export class PostgresAdapter implements IDbAdapter {
	public static variant = "PostgreSQL";
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly keyless = new Set<string>();

	private reservedConn: Awaited<ReturnType<SQL["reserve"]>> | null = null;
	private transactionDb: Kysely<FluxifyDatabase> | null = null;

	constructor(
		private readonly db: Kysely<FluxifyDatabase>,
		private readonly sql: SQL,
	) {}

	public static createKysely(sql: SQL): Kysely<FluxifyDatabase> {
		return new Kysely<FluxifyDatabase>({
			dialect: new BunSqlPostgresDialect(sql),
		});
	}

	public static async testConnection(
		connection: Connection,
	): Promise<{ success: boolean; error?: any }> {
		const url =
			`postgres://${connection.username}:${connection.password}` +
			`@${connection.host}:${connection.port}/${connection.database}`;

		const sql = new SQL(url, {
			tls: connection.ssl,
			max: 2,
		});

		try {
			const result = await sql.unsafe("SELECT 1 AS test");
			const resultRows = result as Array<Record<string, any>>;
			return { success: resultRows[0]?.test == 1 };
		} catch (error) {
			return { success: false, error };
		} finally {
			await sql.close();
		}
	}

	async raw(query: string | any, params?: any[]): Promise<any> {
		if (typeof query !== "string") throw new Error("raw() accepts only string queries.");

		const conn = this.getConnection();
		// rows only: the full result carries a BigInt `numAffectedRows` that JSON cannot serialize
		const result = await conn.executeQuery(CompiledQuery.raw(query, params ?? []));
		return result.rows;
	}

	private primaryKey(table: string): Promise<string[]> {
		return cachedPrimaryKey(this.db, this.keyless, table, async () => {
			const rows: { column_name: string }[] = await this.raw(PRIMARY_KEY_SQL, [
				regclassName(table),
			]);
			return rows.map((r) => r.column_name);
		});
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
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins, "postgres", qualifiers);
		qb = this.buildQuery(conditions, qb, qualifiers);

		const sorts = await this.withKeys(activeSorts(sort), table, options);

		let q = applyColumns(qb, options?.columns).offset(offset);
		if (limit !== null) q = q.limit(limit);
		return applySqlSort(q, sorts, "postgres", qualifiers).execute();
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
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins, "postgres", qualifiers);
		qb = this.buildQuery(conditions, qb, qualifiers);
		const sorts = cursorSorts(
			activeSorts(sort),
			cursor.keys,
			await this.primaryKey(table),
			table,
			!!options?.joins?.length,
		);
		return sqlPage(qb, sorts, limit, cursor.after, options?.columns, "postgres", qualifiers);
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<any | null> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins, "postgres", qualifiers);
		qb = this.buildQuery(conditions, qb, qualifiers);
		// unsorted stays unsorted: an ORDER BY nobody asked for only costs time
		const given = activeSorts(options?.sort);
		const sorts = given.length ? await this.withKeys(given, table, options) : [];
		// strict reads a second row only to tell that there is one
		const rows = await applySqlSort(
			applyColumns(qb, options?.columns).limit(options?.strict ? 2 : 1),
			sorts,
			"postgres",
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
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins, "postgres", qualifiers);
		qb = this.buildQuery(conditions, qb, qualifiers);
		const row = await qb.select((eb) => eb.fn.countAll().as("count")).executeTakeFirst();
		// COUNT(*) comes back as a bigint string
		return Number(row?.count ?? 0);
	}

	async delete(table: string, conditions: DBConditionType[]): Promise<WriteResult> {
		const qb = this.buildQuery(conditions, this.getConnection().deleteFrom(table as never));
		const affected = await qb.returningAll().execute();
		return { count: affected.length, affected };
	}

	async insert(table: string, data: any, onConflict?: OnConflict): Promise<any> {
		const conn = this.getConnection();
		const { rows, counters } = upsertRows([data], onConflict);
		const qb = conn.insertInto(table as never).values(rows[0] as never);
		const res = await withConflict(qb, table, rows, counters, onConflict)
			.returningAll()
			.execute()
			.catch((e) => explainConflict(e, table, onConflict));
		// an ignored duplicate returns no row
		return res[0] ?? null;
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
				const qb = conn.insertInto(table as never).values(chunk as never);
				const res = await withConflict(qb, table, chunk, counters, onConflict)
					.returningAll()
					.execute()
					.catch((e) => explainConflict(e, table, onConflict));
				results.push(...res);
			}
			return results;
		};

		if (!useTransaction || this.mode === DbAdapterMode.TRANSACTION)
			return insertChunks(this.getConnection());

		// A transaction of its own on a reserved connection, not the adapter's mode: parallel
		// chains share this adapter and must not join it. Not Kysely's db.transaction(): the
		// shared Bun driver would run BEGIN and the inserts on different connections.
		const reserved = await this.sql.reserve();
		try {
			await reserved.unsafe("BEGIN");
			const trx = new Kysely<FluxifyDatabase>({
				dialect: new BunSqlPostgresDialect(reserved as any as SQL),
			});
			const results = await insertChunks(trx);
			await reserved.unsafe("COMMIT");
			return results;
		} catch (error) {
			await reserved.unsafe("ROLLBACK").catch(() => {});
			throw error;
		} finally {
			reserved.release();
		}
	}

	/**
	 * One statement: the CTE locks the matching rows and keeps each as it was, the update joins
	 * them back by primary key and returns whether the row really changed. Not by ctid: a row
	 * another run updated while we waited has a new ctid, the join would miss it and lose the update.
	 */
	async update(table: string, data: any, conditions: DBConditionType[]): Promise<WriteResult> {
		const conn = this.getConnection();
		const set = sqlCounterSet(data) as never;
		const pk = await this.primaryKey(table);
		if (pk.length === 0) {
			// ponytail: no key to pair rows before/after, so every matched row counts as changed
			const affected = await this.buildQuery(conditions, conn.updateTable(table as never).set(set))
				.returningAll()
				.execute();
			return { count: affected.length, affected };
		}

		const t = sql.table(table);
		// keys aliased: a bare key name in SET would be ambiguous between the table and __old
		const before = this.buildQuery(conditions, conn.selectFrom(table as never))
			.select([
				...pk.map((c, i) => sql`${t}.${sql.ref(c)}`.as(`__k${i}`)),
				sql`to_jsonb(${t}.*)`.as("__before"),
			])
			.forUpdate();
		const rows: Record<string, any>[] = await conn
			.with("__old", () => before as never)
			.updateTable(table as never)
			.set(set)
			.from("__old" as never)
			.where(
				sql.join(
					pk.map((c, i) => sql`${t}.${sql.ref(c)} = __old.${sql.ref(`__k${i}`)}`),
					sql` and `,
				) as never,
			)
			.returningAll(table as never)
			.returning(sql`__old.__before is distinct from to_jsonb(${t}.*)`.as("__changed") as never)
			.execute();
		const affected = rows.filter((r) => r.__changed).map(({ __changed, ...row }) => row);
		return { count: affected.length, affected };
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(isolation?: IsolationLevel): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;

		this.reservedConn = await this.sql.reserve();

		try {
			await this.reservedConn.unsafe(`BEGIN${isolationClause(isolation)}`);
		} catch (e) {
			this.reservedConn.release();
			this.reservedConn = null;
			throw e;
		}

		const reservedSql = this.reservedConn as any as SQL;
		this.transactionDb = new Kysely<FluxifyDatabase>({
			dialect: new BunSqlPostgresDialect(reservedSql),
		});
		await this.setMode(DbAdapterMode.TRANSACTION);
	}

	async commitTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
			throw new Error("Not in transaction mode");

		try {
			await this.reservedConn.unsafe("COMMIT");
		} finally {
			this.reservedConn.release();
			this.reservedConn = null;
			this.transactionDb = null;
			await this.setMode(DbAdapterMode.NORMAL);
		}
	}

	async rollbackTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
			throw new Error("Not in transaction mode");

		try {
			await this.reservedConn.unsafe("ROLLBACK");
		} finally {
			this.reservedConn.release();
			this.reservedConn = null;
			this.transactionDb = null;
			await this.setMode(DbAdapterMode.NORMAL);
		}
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
		return applySqlConditions(builder, conditions, "postgres", qualifiers);
	}
}

/**
 * ON CONFLICT (target) DO UPDATE / DO NOTHING. Nothing left to update still returns the
 * existing row: the target is set to itself. A counter adds the incoming amount to the row's.
 */
function withConflict<B extends InsertQueryBuilder<any, any, any>>(
	qb: B,
	table: string,
	rows: object[],
	counters: string[],
	onConflict?: OnConflict,
): B {
	if (!onConflict) return qb;
	return qb.onConflict((oc) => {
		const on = oc.columns(onConflict.target as never);
		if (onConflict.action === "ignore") return on.doNothing();
		const columns = conflictUpdateColumns(rows, onConflict);
		const set = columns.length ? columns : onConflict.target.slice(0, 1);
		return on.doUpdateSet(
			Object.fromEntries(
				set.map((c) => [
					c,
					counters.includes(c)
						? sql`${sql.ref(`${table}.${c}`)} + ${sql.ref(`excluded.${c}`)}`
						: sql.ref(`excluded.${c}`),
				]),
			) as never,
		);
	}) as B;
}

/** Postgres rejects ON CONFLICT without a matching unique index; say which one is missing */
function explainConflict(error: unknown, table: string, onConflict?: OnConflict): never {
	if (onConflict && String((error as Error)?.message).includes("ON CONFLICT specification"))
		throw new Error(
			`upsert on ${table} needs a unique index or constraint on (${onConflict.target.join(", ")})`,
			{ cause: error },
		);
	throw error;
}

export function buildPgUrl(connection: Connection): string {
	const { username, password, host, port, database } = connection;
	return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function extractPgConnectionInfo(
	config: Record<string, any>,
	appConfigs: Map<string, string>,
	pgUrlParser: (url: string) => Connection | null,
) {
	if (config.source === "url") {
		let urlStr = String(config.url);
		urlStr = urlStr.startsWith("cfg:") ? (appConfigs.get(urlStr.slice(4)) ?? "") : urlStr;
		const result = pgUrlParser(urlStr);
		if (result === null) return null;
		return {
			host: result.host,
			port: result.port,
			database: result.database,
			username: result.username,
			password: result.password,
			ssl: result.ssl === true,
			dbType: result.dbType,
		};
	}

	for (const key in config) {
		const value = String(config[key]);
		config[key] = value.startsWith("cfg:") ? (appConfigs.get(value.slice(4)) ?? "") : value;
	}
	return config;
}
