import { password, SQL } from "bun";
import { Kysely } from "kysely";
import { operatorSchema } from "@fluxify/lib";
import z from "zod";
import { Connection, DbType } from "./connection";
import { PostgresAdapter } from "./postgresAdapter";
import { MySqlAdapter } from "./mySqlAdapter";
import { JsVM } from "@fluxify/lib";
import { BunSqlPostgresDialect, BunSqlMysqlDialect } from "./kyselySqlDialect";
import { MongoAdapter, buildMongoUrl } from "./mongoDbAdapter";
import { createPool } from "mysql2";

export const whereConditionSchema = z.object({
	attribute: z.string(),
	operator: operatorSchema.exclude(["js", "is_empty", "is_not_empty"]),
	value: z.string().or(z.number()),
	chain: z.enum(["and", "or"]),
});

export type DBConditionType = z.infer<typeof whereConditionSchema>;

export enum DbAdapterMode {
	NORMAL = 1,
	TRANSACTION = 2,
}

export interface IDbAdapter {
	getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number,
		offset: number,
		sort: { attribute: string; direction: "asc" | "desc" },
	): Promise<unknown[]>;
	getSingle(
		table: string,
		conditions: DBConditionType[],
	): Promise<unknown | null>;
	insert(table: string, data: unknown): Promise<any>;
	insertBulk(table: string, data: unknown[]): Promise<any>;
	update(
		table: string,
		data: unknown,
		conditions: DBConditionType[],
	): Promise<any>;
	raw(query: string | unknown, params?: any[]): Promise<any>;
	delete(table: string, conditions: DBConditionType[]): Promise<boolean>;
	setMode(mode: DbAdapterMode): Promise<void>;
	startTransaction(): Promise<void>;
	commitTransaction(): Promise<void>;
	rollbackTransaction(): Promise<void>;
}

export class DbFactory {
	private readonly connectionMap: Record<string, IDbAdapter> = {};

	constructor(
		private readonly vm: JsVM,
		private readonly dbConfig: Record<string, Connection>,
	) {}

	public getDbAdapter(connection: string): IDbAdapter {
		const cfg = this.dbConfig[connection];
		if (!cfg) {
			throw new Error("config is null while creating db adapter");
		}
		if (connection in this.connectionMap) return this.connectionMap[connection];

		if (cfg.dbType.toLowerCase() === DbType.POSTGRES.toLowerCase()) {
			const { db, sql } = this.getBunPostgresSqlConnection(connection, cfg);
			return (this.connectionMap[connection] = new PostgresAdapter(
				db,
				sql,
				this.vm,
			));
		} else if (cfg.dbType.toLowerCase() === DbType.MYSQL.toLowerCase()) {
			const pool = createPool({
				host: cfg.host,
				port: Number(cfg.port),
				user: cfg.username,
				password: cfg.password,
				database: cfg.database,
				connectionLimit: 2,
			});
			const db = MySqlAdapter.createKysely(pool);
			return (this.connectionMap[connection] = new MySqlAdapter(
				db,
				pool,
				this.vm,
			));
		} else if (cfg.dbType.toLowerCase() === DbType.MONGODB.toLowerCase()) {
			const { client, db } = this.getMongoClient(connection, cfg);
			return (this.connectionMap[connection] = new MongoAdapter(
				client,
				db,
				this.vm,
			));
		}

		throw new Error(`${cfg.dbType} Not implemented`);
	}

	private static connectionCache: Record<
		string,
		{ db: Kysely<any>; sql: SQL }
	> = {};

	private getBunPostgresSqlConnection(
		connection: string,
		cfg: Connection,
	): { db: Kysely<any>; sql: SQL } {
		if (connection in DbFactory.connectionCache) {
			return DbFactory.connectionCache[connection];
		}

		const sql = new SQL({
			adapter: "postgres",
			hostname: cfg.host,
			port: Number(cfg.port),
			username: cfg.username,
			password: cfg.password,
			database: cfg.database,
			tls: cfg.ssl,
		});

		const dialect = new BunSqlPostgresDialect(sql);

		const db = new Kysely<any>({ dialect });

		return (DbFactory.connectionCache[connection] = { db, sql });
	}

	private static mongoConnectionCache: Record<
		string,
		{ client: any; db: any }
	> = {};

	private getMongoClient(
		connection: string,
		cfg: Connection,
	): { client: any; db: any } {
		if (connection in DbFactory.mongoConnectionCache) {
			return DbFactory.mongoConnectionCache[connection];
		}

		// Lazy load to avoid requiring it if unused or to match current pattern
		const { MongoClient } = require("mongodb");
		const url = buildMongoUrl(cfg);
		const client = new MongoClient(url);
		const db = client.db(cfg.database);

		return (DbFactory.mongoConnectionCache[connection] = { client, db });
	}

	/** Call when app config / integration credentials change. */
	public static async ResetConnections() {
		const proms = Object.values(this.connectionCache).map(({ db, sql }) =>
			db.destroy().then(() => sql.close()),
		);
		this.connectionCache = {};

		const mongoProms = Object.values(this.mongoConnectionCache).map(
			({ client }) => client.close(),
		);
		this.mongoConnectionCache = {};

		await Promise.allSettled([...proms, ...mongoProms]);
	}
}

export * from "./postgresAdapter";
export * from "./mySqlAdapter";
export * from "./mongoDbAdapter";
export * from "./connection";
