import { SQL } from "bun";
import { operatorSchema } from "@fluxify/lib";
import z from "zod";
import { Connection, DbType } from "./connection";
import { PostgresAdapter } from "./postgresAdapter";
import { MySqlAdapter } from "./mySqlAdapter";
import { JsVM } from "@fluxify/lib";
import { MongoAdapter, buildMongoUrl } from "./mongoDbAdapter";
import { DbConnectionManager, type DbConnectionLease } from "./connectionManager";

/** opt-in tag that makes a side name a column instead of holding a value */
export const columnRefSchema = z.object({
	kind: z.literal("column"),
	value: z.string(),
});

/** the mirror tag: a side that holds a value where a column is the default */
export const literalRefSchema = z.object({
	kind: z.literal("literal"),
	value: z.union([z.string(), z.number(), z.boolean()]),
});

export const whereConditionSchema = z.object({
	// untagged: a column, which is what an attribute is by position
	attribute: z.union([z.string(), columnRefSchema, literalRefSchema]),
	operator: operatorSchema.exclude(["js", "is_empty", "is_not_empty"]),
	// untagged: a literal, so a dotted value is never read as a column path
	value: z.union([z.string(), z.number(), columnRefSchema, literalRefSchema]),
	chain: z.enum(["and", "or"]),
});

export type DBConditionType = z.infer<typeof whereConditionSchema>;

export type { DBJoinType, QueryOptions } from "./jsonPath";
import type { QueryOptions } from "./jsonPath";

export type IntrospectedColumn = {
	name: string;
	type: string;
	/** table that owns the column — the referenced table for a foreign key, else the column's own table */
	owner: string;
};

export type IntrospectedTable = {
	table: string;
	columns: IntrospectedColumn[];
};

/** groups flat information_schema rows into the IntrospectedTable shape */
export function groupIntrospectionRows(
	rows: Array<{
		table_name: string;
		column_name: string;
		data_type: string;
		ref_table: string | null;
	}>,
): IntrospectedTable[] {
	const byTable = new Map<string, IntrospectedTable>();
	for (const r of rows) {
		let entry = byTable.get(r.table_name);
		if (!entry) byTable.set(r.table_name, (entry = { table: r.table_name, columns: [] }));
		entry.columns.push({
			name: r.column_name,
			type: r.data_type,
			owner: r.ref_table ?? r.table_name,
		});
	}
	return [...byTable.values()];
}

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
		options?: QueryOptions,
	): Promise<unknown[]>;
	getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<unknown | null>;
	insert(table: string, data: unknown): Promise<any>;
	insertBulk(table: string, data: unknown[]): Promise<any>;
	update(
		table: string,
		data: unknown,
		conditions: DBConditionType[],
	): Promise<any>;
	raw(query?: string | unknown, params?: any[]): Promise<any>;
	/** optional — adapters that cannot describe their schema simply omit it */
	introspect?(): Promise<IntrospectedTable[]>;
	delete(table: string, conditions: DBConditionType[]): Promise<boolean>;
	setMode(mode: DbAdapterMode): Promise<void>;
	startTransaction(): Promise<void>;
	commitTransaction(): Promise<void>;
	rollbackTransaction(): Promise<void>;
}

export class DbFactory {
	private readonly connectionMap: Record<string, IDbAdapter> = {};
	private readonly connectionLeases: Record<string, DbConnectionLease> = {};
	private static readonly defaultConnectionManager = new DbConnectionManager();

	constructor(
		private readonly vm: JsVM,
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
			return (this.connectionMap[connection] = new PostgresAdapter(
				lease.connection.db,
				lease.connection.sql!,
				this.vm,
			));
		} else if (cfg.dbType.toLowerCase() === DbType.MYSQL.toLowerCase()) {
			return (this.connectionMap[connection] = new MySqlAdapter(
				lease.connection.db,
				lease.connection.pool!,
				this.vm,
			));
		} else if (cfg.dbType.toLowerCase() === DbType.MONGODB.toLowerCase()) {
			return (this.connectionMap[connection] = new MongoAdapter(
				lease.connection.client!,
				lease.connection.db,
				this.vm,
			));
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
export async function introspectConnection(
	cfg: Connection,
): Promise<IntrospectedTable[]> {
	const vm = {} as JsVM; // introspection never evaluates js conditions

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
			return await new PostgresAdapter(db, sql, vm).introspect();
		} finally {
			await sql.close();
		}
	}

	if (cfg.dbType.toLowerCase() === DbType.MYSQL.toLowerCase()) {
		const pool = MySqlAdapter.createPool(cfg);
		try {
			return await new MySqlAdapter(
				MySqlAdapter.createKysely(pool),
				pool,
				vm,
			).introspect();
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
			return await new MongoAdapter(client, client.db(cfg.database), vm).introspect();
		} finally {
			await client.close();
		}
	}

	throw new Error(`${cfg.dbType} introspection not implemented`);
}

export * from "./postgresAdapter";
export * from "./mySqlAdapter";
export * from "./mongoDbAdapter";
export * from "./connection";
export * from "./connectionManager";
