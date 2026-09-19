import { SQL } from "bun";
import { CompiledQuery, Kysely } from "kysely";
import {
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
import { BunSqlPostgresDialect } from "./kyselySqlDialect";

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

export class PostgresAdapter implements IDbAdapter {
	public static variant = "PostgreSQL";
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly HARD_LIMIT = 1000;

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
		const sortExpr = resolveJsonOperand(sort.attribute, false, "postgres", qualifiers);

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
		const result = await qb.execute();

		// Safe property access without using 'any'
		const rows = result as any as Array<Record<string, any>>;
		return Number(rows[0]?.numDeletedRows ?? 0) > 0;
	}

	async insert(table: string, data: any): Promise<any> {
		const conn = this.getConnection();
		const res = await conn
			.insertInto(table as never)
			.values(data as never)
			.returningAll()
			.execute();
		return Array.isArray(res) ? res[0] : res;
	}

	async insertBulk(table: string, data: Record<string, any>[]): Promise<any[]> {
		if (!data || data.length === 0) return [];

		const chunkSize = 1000;
		const results: any[] = [];
		const conn = this.getConnection();

		for (let i = 0; i < data.length; i += chunkSize) {
			const chunk = data.slice(i, i + chunkSize);
			const res = await conn
				.insertInto(table as never)
				.values(chunk as never)
				.returningAll()
				.execute();
			results.push(...res);
		}
		return results;
	}

	async update(table: string, data: any, conditions: DBConditionType[]): Promise<any> {
		const conn = this.getConnection();
		let qb = conn.updateTable(table as never).set(data as never);
		qb = this.buildQuery(conditions, qb);
		return qb.returningAll().execute();
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;

		this.reservedConn = await this.sql.reserve();

		try {
			await this.reservedConn.unsafe("BEGIN");
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
