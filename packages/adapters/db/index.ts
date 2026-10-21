import {
	bulkChunkSize,
	type Connection,
	changedRows,
	columnRefSchema,
	type DatabaseAdapter,
	type DBConditionType,
	DbAdapterMode,
	type DbConditionGroup,
	type DbCursor,
	type DbPage,
	type DbSort,
	DbType,
	groupIntrospectionRows,
	type IDbAdapter,
	type IntrospectedColumn,
	type IntrospectedTable,
	type IsolationLevel,
	literalRefSchema,
	type OnConflict,
	type QueryOptions,
	type RawDbCondition,
	rawWhereConditionSchema,
	structuredWhereConditionSchema,
	type WriteResult,
	whereConditionSchema,
} from "@fluxify/sdk/integrations";
import { SQL } from "bun";
import { type DbConnectionLease, DbConnectionManager } from "./connectionManager";
import { describeMongo, describeSql, type SchemaDetails, type SqlRun } from "./describe";
import { buildMongoUrl, MongoAdapter } from "./mongoDbAdapter";
import { MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

export * from "./counter";
export type { DBJoinType } from "./jsonPath";
export * from "./upsert";
export {
	bulkChunkSize,
	changedRows,
	columnRefSchema,
	type DatabaseAdapter,
	type DBConditionType,
	DbAdapterMode,
	type DbConditionGroup,
	type DbCursor,
	type DbPage,
	type DbSort,
	groupIntrospectionRows,
	type IDbAdapter,
	type IntrospectedColumn,
	type IntrospectedTable,
	literalRefSchema,
	type OnConflict,
	type QueryOptions,
	type RawDbCondition,
	rawWhereConditionSchema,
	structuredWhereConditionSchema,
	type WriteResult,
	whereConditionSchema,
};

export class DbFactory {
	private readonly connectionMap: Record<string, IDbAdapter> = {};
	private readonly connectionLeases: Record<string, DbConnectionLease> = {};
	private static readonly defaultConnectionManager = new DbConnectionManager();

	constructor(
		private readonly dbConfig: Record<string, Connection>,
		private readonly connectionManager: DbConnectionManager = DbFactory.defaultConnectionManager,
	) {}

	public getDbAdapter(connection: string): IDbAdapter {
		const cfg = this.dbConfig[connection];
		if (!cfg) {
			throw new Error("config is null while creating db adapter");
		}
		if (connection in this.connectionMap) return this.connectionMap[connection];

		const lease = this.connectionManager.borrow(connection, cfg);
		this.connectionLeases[connection] = lease;

		if (cfg.dbType.toLowerCase() === DbType.POSTGRES.toLowerCase()) {
			this.connectionMap[connection] = new PostgresAdapter(
				lease.connection.db,
				lease.connection.sql!,
			);
			return this.connectionMap[connection];
		} else if (cfg.dbType.toLowerCase() === DbType.MYSQL.toLowerCase()) {
			this.connectionMap[connection] = new MySqlAdapter(
				lease.connection.db,
				lease.connection.pool!,
			);
			return this.connectionMap[connection];
		} else if (cfg.dbType.toLowerCase() === DbType.MONGODB.toLowerCase()) {
			this.connectionMap[connection] = new MongoAdapter(
				lease.connection.client!,
				lease.connection.db,
			);
			return this.connectionMap[connection];
		}

		lease.release();
		delete this.connectionLeases[connection];
		throw new Error(`${cfg.dbType} Not implemented`);
	}

	/** Releases this request's database-client leases. */
	public dispose() {
		for (const connection of Object.keys(this.connectionLeases)) {
			this.connectionLeases[connection].release();
			delete this.connectionLeases[connection];
		}
	}

	/** Compatibility hook for legacy workers that use the process-wide manager. */
	public static async ResetConnections() {
		await this.defaultConnectionManager.close();
	}
}

/**
 * Opens a short-lived connection, describes the schema and closes it again.
 * Design-time only — runtime queries go through DbFactory's pooled adapters.
 */
export async function introspectConnection(cfg: Connection): Promise<IntrospectedTable[]> {
	if (cfg.dbType.toLowerCase() === DbType.POSTGRES.toLowerCase()) {
		const sql = new SQL({
			adapter: "postgres",
			hostname: cfg.host,
			port: Number(cfg.port),
			username: cfg.username,
			password: cfg.password,
			database: cfg.database,
			tls: cfg.ssl,
			max: 2,
		});
		const db = PostgresAdapter.createKysely(sql);
		try {
			return await new PostgresAdapter(db, sql).introspect();
		} finally {
			await sql.close();
		}
	}

	if (cfg.dbType.toLowerCase() === DbType.MYSQL.toLowerCase()) {
		const pool = MySqlAdapter.createPool(cfg);
		try {
			return await new MySqlAdapter(MySqlAdapter.createKysely(pool), pool).introspect();
		} finally {
			await pool.promise().end();
		}
	}

	if (cfg.dbType.toLowerCase() === DbType.MONGODB.toLowerCase()) {
		const { MongoClient } = require("mongodb");
		const client = new MongoClient(buildMongoUrl(cfg), {
			serverSelectionTimeoutMS: 5000,
		});
		try {
			await client.connect();
			return await new MongoAdapter(client, client.db(cfg.database)).introspect();
		} finally {
			await client.close();
		}
	}

	throw new Error(`${cfg.dbType} introspection not implemented`);
}

/** Like introspectConnection, for the agent's schema details (#652): names, or detail for `tables`. */
export async function describeConnection(
	cfg: Connection,
	tables?: string[],
): Promise<SchemaDetails> {
	const type = cfg.dbType.toLowerCase();
	if (type === DbType.POSTGRES.toLowerCase()) {
		const sql = new SQL({
			adapter: "postgres",
			hostname: cfg.host,
			port: Number(cfg.port),
			username: cfg.username,
			password: cfg.password,
			database: cfg.database,
			tls: cfg.ssl,
			max: 1,
			connectionTimeout: 5,
		});
		try {
			return await describeSql("postgres", (q, p) => sql.unsafe(q, p as any[]), tables);
		} finally {
			await sql.close();
		}
	}
	if (type === DbType.MYSQL.toLowerCase()) {
		const pool = MySqlAdapter.createPool(cfg);
		try {
			const run: SqlRun = async (q, p) => (await pool.promise().query(q, p))[0] as any[];
			return await describeSql("mysql", run, tables);
		} finally {
			await pool.promise().end();
		}
	}
	if (type === DbType.MONGODB.toLowerCase()) {
		const { MongoClient } = require("mongodb");
		const client = new MongoClient(buildMongoUrl(cfg), { serverSelectionTimeoutMS: 5000 });
		try {
			await client.connect();
			return await describeMongo(client.db(cfg.database), tables);
		} finally {
			await client.close();
		}
	}
	throw new Error(`${cfg.dbType} schema details not supported`);
}

export * from "./connection";
export * from "./connectionManager";
export * from "./describe";
export * from "./mongoDbAdapter";
export * from "./mongoNative";
export * from "./mySqlAdapter";
export * from "./postgresAdapter";
export * from "./transactionErrors";
