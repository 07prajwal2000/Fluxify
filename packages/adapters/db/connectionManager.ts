import { createHash } from "node:crypto";
import {
	LeasedResources,
	type LeasedResourcesOptions,
	type ResourceSpec,
	type ResourceTimer,
} from "@fluxify/lib";
import { SQL } from "bun";
import { MongoClient } from "mongodb";
import { createPool, type Pool } from "mysql2";
import {
	type Connection,
	DbType,
	DEFAULT_MAX_CONNECTIONS,
	DEFAULT_QUERY_TIMEOUT_MS,
	MAX_MAX_CONNECTIONS,
} from "./connection";
import { buildMongoUrl, MongoAdapter } from "./mongoDbAdapter";
import { MYSQL_POOL_OPTIONS, MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

export type ManagedDbConnection = {
	type: DbType;
	db: any;
	pool?: Pool;
	sql?: SQL;
	client?: MongoClient;
	close(): Promise<void>;
};

export type DbConnectionLease = {
	connection: ManagedDbConnection;
	release(): void;
};

export type DbConnectionFactory = (
	integrationId: string,
	config: Connection,
	fingerprint: string,
) => ManagedDbConnection;

export type DbConnectionTimer = ResourceTimer;

export type DbConnectionManagerOptions = LeasedResourcesOptions;

/**
 * Owns the database clients for one execution runtime. Factories borrow a
 * client while keeping adapter and transaction state request-local.
 */
export class DbConnectionManager {
	private readonly resources: LeasedResources<ManagedDbConnection>;

	constructor(
		private readonly createConnection: DbConnectionFactory = createManagedConnection,
		options: DbConnectionManagerOptions = {},
	) {
		this.resources = new LeasedResources(options);
	}

	borrow(integrationId: string, config: Connection): DbConnectionLease {
		const fingerprint = connectionFingerprint(config);
		const lease = this.resources.acquire(
			integrationId,
			fingerprint,
			this.spec(integrationId, config, fingerprint),
		);
		return { connection: lease.value, release: lease.release };
	}

	/**
	 * Applies a complete integration snapshot. Changed clients are swapped before
	 * the old client starts draining, so new requests never borrow stale config.
	 */
	synchronize(configurations: Record<string, Connection>) {
		for (const [integrationId, current] of this.resources.fingerprints()) {
			const config = configurations[integrationId];
			if (!config) {
				this.resources.remove(integrationId);
				continue;
			}

			const fingerprint = connectionFingerprint(config);
			if (current !== fingerprint) {
				this.resources.replace(
					integrationId,
					fingerprint,
					this.spec(integrationId, config, fingerprint),
				);
			}
		}
	}

	close() {
		return this.resources.close();
	}

	getStats() {
		return this.resources.getStats();
	}

	private spec(
		integrationId: string,
		config: Connection,
		fingerprint: string,
	): ResourceSpec<ManagedDbConnection> {
		return {
			create: () => this.createConnection(integrationId, config, fingerprint),
			destroy: (connection) => connection.close(),
		};
	}
}

/** Hashes only the fields that affect a database connection; the raw secret is never retained or logged. */
export function connectionFingerprint(config: Connection) {
	const material = JSON.stringify({
		dbType: config.dbType,
		host: config.host,
		port: String(config.port),
		username: config.username,
		password: config.password,
		database: config.database,
		ssl: Boolean(config.ssl),
		queryTimeoutMs: config.queryTimeoutMs,
		maxConnections: config.maxConnections,
	});
	return createHash("sha256").update(material).digest("hex");
}

function createManagedConnection(_integrationId: string, config: Connection): ManagedDbConnection {
	const timeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
	// capped here too: a row saved before the cap, or written around the API, still gets a sane pool
	const max = Math.min(
		config.maxConnections ?? DEFAULT_MAX_CONNECTIONS[config.dbType],
		MAX_MAX_CONNECTIONS[config.dbType],
	);
	if (config.dbType === DbType.POSTGRES) {
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

	if (config.dbType === DbType.MYSQL) {
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

	if (config.dbType === DbType.MONGODB) {
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

	throw new Error(`${config.dbType} Not implemented`);
}
