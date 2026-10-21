import { SQL } from "bun";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2";
import {
	type Connection,
	DbType,
	DEFAULT_MAX_CONNECTIONS,
	DEFAULT_QUERY_TIMEOUT_MS,
	MAX_MAX_CONNECTIONS,
} from "./connection";
import type { ManagedDbConnection } from "./connectionManager";
import { buildMongoUrl } from "./mongoDbAdapter";
import { MYSQL_POOL_OPTIONS, MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

/** The pooled clients of the built-in database variants, one per integration per worker. */

function limits(config: Connection) {
	const type = config.dbType;
	return {
		timeoutMs: config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
		// capped here too: a row saved before the cap, or written around the API, still gets a sane pool
		max: Math.min(
			config.maxConnections ?? DEFAULT_MAX_CONNECTIONS[type],
			MAX_MAX_CONNECTIONS[type],
		),
	};
}

export function connectPostgres(config: Connection): ManagedDbConnection {
	const { timeoutMs, max } = limits(config);
	const sql = new SQL({
		adapter: "postgres",
		hostname: config.host,
		port: Number(config.port),
		username: config.username,
		password: config.password,
		database: config.database,
		tls: config.ssl,
		// #512: int8 as BigInt, so it can be told apart from numeric's text
		bigint: true,
		max,
		connection: { statement_timeout: timeoutMs },
	});
	const db = PostgresAdapter.createKysely(sql);
	return {
		type: DbType.POSTGRES,
		db,
		sql,
		close: () => db.destroy(),
	};
}

export function connectMysql(config: Connection): ManagedDbConnection {
	const { timeoutMs, max } = limits(config);
	const pool = createPool({
		host: config.host,
		port: Number(config.port),
		user: config.username,
		password: config.password,
		database: config.database,
		connectionLimit: max,
		...MYSQL_POOL_OPTIONS,
	});
	// ponytail: max_execution_time stops reads only; a write is bounded by lock waits, not by run time
	pool.on("connection", (conn) => {
		conn.query("SET SESSION max_execution_time = ?, innodb_lock_wait_timeout = ?", [
			timeoutMs,
			Math.max(1, Math.ceil(timeoutMs / 1000)),
		]);
	});
	return {
		type: DbType.MYSQL,
		db: MySqlAdapter.createKysely(pool),
		pool,
		close: () => pool.promise().end(),
	};
}

export function connectMongo(config: Connection): ManagedDbConnection {
	const { timeoutMs, max } = limits(config);
	const client = new MongoClient(buildMongoUrl(config), {
		timeoutMS: timeoutMs,
		maxPoolSize: max,
	});
	return {
		type: DbType.MONGODB,
		db: client.db(config.database),
		client,
		close: () => client.close(),
	};
}
