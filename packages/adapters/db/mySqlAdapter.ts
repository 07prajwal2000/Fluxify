import { CompiledQuery, Kysely, MysqlDialect } from "kysely";
import { createPool, type Pool } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import {
	bulkChunkSize,
	type Connection,
	type DBConditionType,
	DbAdapterMode,
	groupIntrospectionRows,
	type IDbAdapter,
	type IntrospectedTable,
} from ".";
import { applySqlConditions } from "./conditions";
import {
	applyColumns,
	applyJoins,
	buildQualifiers,
	type QueryOptions,
	resolveJsonOperand,
} from "./jsonPath";

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
	private readonly HARD_LIMIT = 1000;

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
			dialect: new MysqlDialect({ pool }),
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
		limit: number = this.HARD_LIMIT,
		offset: number = 0,
		sort: { attribute: string; direction: "asc" | "desc" },
		options?: QueryOptions,
	): Promise<any[]> {
		const conn = this.getConnection();
		const qualifiers = buildQualifiers(table, options?.joins);
		let qb = applyJoins(conn.selectFrom(table as never), options?.joins);
		qb = this.buildQuery(conditions, qb, qualifiers);

		const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit;
		const sortExpr = resolveJsonOperand(sort.attribute, false, "mysql", qualifiers);

		return applyColumns(qb, options?.columns)
			.limit(l)
			.offset(offset)
			.orderBy(sortExpr as never, sort.direction)
			.execute();
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
		return (await applyColumns(qb, options?.columns).executeTakeFirst()) ?? null;
	}

	async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
		const conn = this.getConnection();
		let qb = conn.deleteFrom(table as never);
		qb = this.buildQuery(conditions, qb);
		const result = await qb.executeTakeFirst();
		return Number(result.numDeletedRows ?? 0) > 0;
	}

	async insert(table: string, data: any): Promise<any> {
		const conn = this.getConnection();
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
	): Promise<any[]> {
		if (!data || data.length === 0) return [];

		const insertChunks = async (conn: Kysely<FluxifyDatabase>) => {
			const chunkSize = bulkChunkSize(data);
			const results: any[] = [];
			for (let i = 0; i < data.length; i += chunkSize) {
				const chunk = data.slice(i, i + chunkSize);
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

	async update(table: string, data: any, conditions: DBConditionType[]): Promise<any> {
		const pk = await this.primaryKey(table);
		if (pk.length === 0) {
			// no key to re-read by: best effort, re-run the conditions
			const conn = this.getConnection();
			await this.buildQuery(
				conditions,
				conn.updateTable(table as never).set(data as never),
			).execute();
			return this.buildQuery(conditions, conn.selectFrom(table as never))
				.selectAll()
				.execute();
		}

		// MySQL has no RETURNING: lock the matching keys, update exactly those, re-read them
		return this.withTransaction(async (trx) => {
			const keys: Row[] = await this.buildQuery(
				conditions,
				trx.selectFrom(table as never).select(pk as never),
			)
				.forUpdate()
				.execute();
			if (keys.length === 0) return [];

			await whereKeys(trx.updateTable(table as never).set(data as never), pk, keys).execute();

			// an update that sets a key column moves the row to that key
			const newKeys = keys.map((k) =>
				Object.fromEntries(pk.map((c) => [c, c in data ? data[c] : k[c]])),
			);
			return whereKeys(trx.selectFrom(table as never).selectAll(), pk, newKeys).execute();
		});
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
