import { isDeepStrictEqual } from "node:util";
import { dbOperatorSchema } from "@fluxify/lib";
import { SQL } from "bun";
import z from "zod";
import { type Connection, DbType, type IsolationLevel } from "./connection";
import { type DbConnectionLease, DbConnectionManager } from "./connectionManager";
import { describeMongo, describeSql, type SchemaDetails, type SqlRun } from "./describe";
import { buildMongoUrl, MongoAdapter } from "./mongoDbAdapter";
import { MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

/** opt-in tag that makes a side name a column instead of holding a value */
export const columnRefSchema = z.object({
	kind: z.literal("column"),
	value: z.string(),
});

/** the mirror tag: a side that holds a value where a column is the default */
export const literalRefSchema = z.object({
	kind: z.literal("literal"),
	value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
});

export const structuredWhereConditionSchema = z.object({
	// untagged: a column, which is what an attribute is by position
	attribute: z.union([z.string(), columnRefSchema, literalRefSchema]),
	operator: dbOperatorSchema,
	// untagged: a literal, so a dotted value is never read as a column path.
	// Absent for is_null / is_not_null / exists / not_exists.
	value: z.union([z.string(), z.number(), columnRefSchema, literalRefSchema]).optional(),
	chain: z.enum(["and", "or"]),
});

/**
 * A hand-written condition, already evaluated by the block: SQL adapters get
 * `{ strings, values }` (the text around each `{{ }}` and the bound values),
 * MongoDB gets the filter object the user's JS returned.
 */
export const rawWhereConditionSchema = z.object({
	operator: z.literal("raw"),
	raw: z.unknown(),
	chain: z.enum(["and", "or"]),
});

export type RawDbCondition = z.infer<typeof rawWhereConditionSchema>;
/** brackets: the group's conditions combine first, then join the list like one condition */
export type DbConditionGroup = { group: DBConditionType[]; chain: "and" | "or" };
export type DBConditionType =
	| z.infer<typeof structuredWhereConditionSchema>
	| RawDbCondition
	| DbConditionGroup;

export const whereConditionSchema: z.ZodType<DBConditionType> = z.union([
	structuredWhereConditionSchema,
	rawWhereConditionSchema,
	z.object({
		get group() {
			return z.array(whereConditionSchema);
		},
		chain: z.enum(["and", "or"]),
	}),
]);

export * from "./counter";
export type { DbCursor, DbPage } from "./cursor";
export type { DBJoinType, QueryOptions } from "./jsonPath";
export type { DbSort } from "./sort";
export * from "./upsert";

import type { DbCursor, DbPage } from "./cursor";
import type { QueryOptions } from "./jsonPath";
import type { DbSort } from "./sort";
import type { OnConflict } from "./upsert";

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
		if (!entry) {
			entry = { table: r.table_name, columns: [] };
			byTable.set(r.table_name, entry);
		}
		entry.columns.push({
			name: r.column_name,
			type: r.data_type,
			owner: r.ref_table ?? r.table_name,
		});
	}
	return [...byTable.values()];
}

/** rows per bulk INSERT: at most 1000, and wide rows stay under the 65,535 bound-parameter cap */
export function bulkChunkSize(rows: object[]): number {
	const columns = new Set(rows.flatMap((r) => Object.keys(r))).size;
	return Math.max(1, Math.min(1000, Math.floor(65535 / Math.max(columns, 1))));
}

export enum DbAdapterMode {
	NORMAL = 1,
	TRANSACTION = 2,
}

export interface IDbAdapter {
	/** `limit` null: every matching row */
	getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		offset: number,
		sort: DbSort[],
		options?: QueryOptions,
	): Promise<unknown[]>;
	/** get-all by cursor: the rows after `cursor.after`, and the cursor for the page after them */
	getPage(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		sort: DbSort[],
		cursor: DbCursor,
		options?: QueryOptions,
	): Promise<DbPage>;
	getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<unknown | null>;
	/** rows matching the conditions (joins included on SQL, ignored on Mongo) */
	count(table: string, conditions: DBConditionType[], options?: QueryOptions): Promise<number>;
	/** with `onConflict`: the row inserted or updated, null when `ignore` skipped it */
	insert(table: string, data: unknown, onConflict?: OnConflict): Promise<any>;
	/**
	 * `useTransaction`: all rows go in or none do; an open transaction is reused either way.
	 * With `onConflict`, rows skipped by `ignore` are left out of the result.
	 */
	insertBulk(
		table: string,
		data: unknown[],
		useTransaction?: boolean,
		onConflict?: OnConflict,
	): Promise<any>;
	/** `count` and `affected` are only the rows whose values changed, as they are after the update */
	update(table: string, data: unknown, conditions: DBConditionType[]): Promise<WriteResult>;
	raw(query?: string | unknown, params?: any[]): Promise<any>;
	/** optional — adapters that cannot describe their schema simply omit it */
	introspect?(): Promise<IntrospectedTable[]>;
	/** `affected` are the deleted rows as they were */
	delete(table: string, conditions: DBConditionType[]): Promise<WriteResult>;
	setMode(mode: DbAdapterMode): Promise<void>;
	/** `isolation` unset: the database's default. MongoDB has no levels and refuses one */
	startTransaction(isolation?: IsolationLevel): Promise<void>;
	commitTransaction(): Promise<void>;
	rollbackTransaction(): Promise<void>;
}

export type WriteResult = { count: number; affected: any[] };

/** rows of `after` that differ from the `before` row under the same key; a key not found there changed */
export function changedRows<R>(before: Map<string, R>, after: R[], keyOf: (row: R) => string) {
	return after.filter((row) => {
		const old = before.get(keyOf(row));
		return !old || !isDeepStrictEqual(old, row);
	});
}

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
