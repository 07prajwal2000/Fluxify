import { SQL } from "bun";
import { CompiledQuery, Kysely } from "kysely";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";
import { BunSqlPostgresDialect } from "./kyselySqlDialect";

export type FluxifyDatabase = Record<string, Record<string, any>>;

export class PostgresAdapter implements IDbAdapter {
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly HARD_LIMIT = 1000;

	private reservedConn: Awaited<ReturnType<SQL["reserve"]>> | null = null;
	private transactionDb: Kysely<FluxifyDatabase> | null = null;

	constructor(
		private readonly db: Kysely<FluxifyDatabase>,
		private readonly sql: SQL,
		private readonly vm: JsVM,
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
		if (typeof query !== "string")
			throw new Error("raw() accepts only string queries.");

		const conn = this.getConnection();
		return conn.executeQuery(CompiledQuery.raw(query, params ?? []));
	}

	async getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number = this.HARD_LIMIT,
		offset: number = 0,
		sort: { attribute: string; direction: "asc" | "desc" },
	): Promise<any[]> {
		const conn = this.getConnection();
		let qb = conn.selectFrom(table as never);
		qb = this.buildQuery(conditions, qb);

		const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit;

		return qb
			.selectAll()
			.limit(l)
			.offset(offset)
			.orderBy(sort.attribute as never, sort.direction)
			.execute();
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
	): Promise<any | null> {
		const conn = this.getConnection();
		let qb = conn.selectFrom(table as never);
		qb = this.buildQuery(conditions, qb);
		return (await qb.selectAll().executeTakeFirst()) ?? null;
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

	async update(
		table: string,
		data: any,
		conditions: DBConditionType[],
	): Promise<any> {
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

	// The bulletproof ExpressionBuilder setup
	private buildQuery<B extends { where: Function }>(
		conditions: DBConditionType[],
		builder: B,
	): B {
		if (!conditions || conditions.length === 0) return builder;

		return builder.where((eb: CallableFunction) => {
			// 1. Create the initial expression using the ExpressionBuilder (eb)
			let expr = eb(
				conditions[0].attribute as never,
				this.getNativeOperator(conditions[0].operator) as never,
				conditions[0].value as never,
			) as { and: Function; or: Function };

			// 2. Chain subsequent expressions just like Kysely Docs Example #2
			for (let i = 1; i < conditions.length; i++) {
				const cond = conditions[i];
				const nextExpr = eb(
					cond.attribute as never,
					this.getNativeOperator(cond.operator) as never,
					cond.value as never,
				);

				if (cond.chain.toLowerCase() === "or") {
					expr = expr.or(nextExpr) as { and: Function; or: Function };
				} else {
					expr = expr.and(nextExpr) as { and: Function; or: Function };
				}
			}

			return expr;
		}) as B;
	}

	private getNativeOperator(
		operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
	): string {
		const map: Record<string, string> = {
			eq: "=",
			neq: "<>",
			gt: ">",
			gte: ">=",
			lt: "<",
			lte: "<=",
		};
		return map[operator] ?? "=";
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
		urlStr = urlStr.startsWith("cfg:")
			? (appConfigs.get(urlStr.slice(4)) ?? "")
			: urlStr;
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
		config[key] = value.startsWith("cfg:")
			? (appConfigs.get(value.slice(4)) ?? "")
			: value;
	}
	return config;
}
