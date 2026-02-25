import { CompiledQuery, Kysely, MysqlDialect } from "kysely";
import { createPool, Pool } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";

// A generic schema to satisfy Kysely's strict typing without using 'any'
type FluxifyDatabase = Record<string, Record<string, any>>;

export class MySqlAdapter implements IDbAdapter {
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly HARD_LIMIT = 1000;

	private reservedConn: PoolConnection | null = null;
	private originalRelease: (() => void) | null = null;
	private transactionDb: Kysely<FluxifyDatabase> | null = null;

	constructor(
		private readonly db: Kysely<FluxifyDatabase>,
		private readonly pool: Pool,
		private readonly vm: JsVM,
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
		const result = await qb.executeTakeFirst();
		return Number(result.numDeletedRows ?? 0) > 0;
	}

	async insert(
		table: string,
		data: any,
		pkColumn: string = "id",
	): Promise<any> {
		const conn = this.getConnection();
		const result = await conn
			.insertInto(table as never)
			.values(data as never)
			.executeTakeFirst();

		const insertId = result?.insertId;
		if (insertId === undefined || insertId === null) return null;

		return conn
			.selectFrom(table as never)
			.selectAll()
			.where(pkColumn as never, "=", Number(insertId) as never)
			.executeTakeFirst();
	}

	async insertBulk(
		table: string,
		data: Record<string, any>[],
		pkColumn: string = "id",
	): Promise<any[]> {
		if (!data || data.length === 0) return [];

		const chunkSize = 1000;
		const results: any[] = [];
		const conn = this.getConnection();

		for (let i = 0; i < data.length; i += chunkSize) {
			const chunk = data.slice(i, i + chunkSize);

			const result = await conn
				.insertInto(table as never)
				.values(chunk as never)
				.executeTakeFirst();

			const firstId = result?.insertId;
			if (firstId === undefined || firstId === null) continue;

			const lastId = Number(firstId) + chunk.length - 1;

			const rows = await conn
				.selectFrom(table as never)
				.selectAll()
				.where(pkColumn as never, ">=", Number(firstId) as never)
				.where(pkColumn as never, "<=", lastId as never)
				.execute();

			results.push(...rows);
		}

		return results;
	}

	async update(
		table: string,
		data: any,
		conditions: DBConditionType[],
		pkColumn: string = "id",
	): Promise<any> {
		const conn = this.getConnection();
		let qb = conn.updateTable(table as never).set(data as never);
		qb = this.buildQuery(conditions, qb);
		await qb.execute();

		let selectQb = conn.selectFrom(table as never);
		selectQb = this.buildQuery(conditions, selectQb);
		return selectQb.selectAll().execute();
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;

		this.reservedConn = await this.pool.promise().getConnection();
		await this.reservedConn.beginTransaction();

		// Safely extract the raw callback connection without using 'any'
		const rawConn = (this.reservedConn as any as { connection: PoolConnection })
			.connection;

		this.originalRelease = rawConn.release.bind(rawConn);
		rawConn.release = () => {};

		this.transactionDb = new Kysely<FluxifyDatabase>({
			dialect: new MysqlDialect({
				pool: {
					getConnection: (cb: (err: any, conn: any) => void) =>
						cb(null, rawConn),
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
			const rawConn = (
				this.reservedConn as any as { connection: PoolConnection }
			).connection;
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

	// Duck-typing the builder generic to strictly ensure .where exists
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
		urlStr = urlStr.startsWith("cfg:")
			? (appConfigs.get(urlStr.slice(4)) ?? "")
			: urlStr;

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
		config[key] = value.startsWith("cfg:")
			? (appConfigs.get(value.slice(4)) ?? "")
			: value;
	}
	return config;
}
