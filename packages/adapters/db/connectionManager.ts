import { SQL } from "bun";
import { createHash } from "node:crypto";
import { Kysely } from "kysely";
import { createPool, type Pool } from "mysql2";
import { MongoClient } from "mongodb";
import { Connection, DbType } from "./connection";
import { MySqlAdapter } from "./mySqlAdapter";
import { MongoAdapter, buildMongoUrl } from "./mongoDbAdapter";
import { PostgresAdapter } from "./postgresAdapter";

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

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

type Entry = {
	integrationId: string;
	fingerprint: string;
	connection: ManagedDbConnection;
	leases: number;
	retired: boolean;
	drainTimer?: ReturnType<typeof setTimeout>;
	closePromise?: Promise<void>;
};

/**
 * Owns the database clients for one execution runtime. Factories borrow a
 * client while keeping adapter and transaction state request-local.
 */
export class DbConnectionManager {
	private readonly active = new Map<string, Entry>();
	private readonly retiring = new Set<Entry>();

	constructor(
		private readonly createConnection: DbConnectionFactory = createManagedConnection,
		private readonly drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
	) {}

	borrow(integrationId: string, config: Connection): DbConnectionLease {
		const fingerprint = connectionFingerprint(config);
		let entry = this.active.get(integrationId);
		if (!entry || entry.fingerprint !== fingerprint) {
			entry = this.replace(integrationId, config, fingerprint, entry);
		}

		entry.leases += 1;
		let released = false;
		return {
			connection: entry.connection,
			release: () => {
				if (released) return;
				released = true;
				entry!.leases -= 1;
				if (entry!.retired && entry!.leases === 0) void this.closeEntry(entry!);
			},
		};
	}

	/**
	 * Applies a complete integration snapshot. Changed clients are swapped before
	 * the old client starts draining, so new requests never borrow stale config.
	 */
	synchronize(configurations: Record<string, Connection>) {
		for (const [integrationId, entry] of this.active) {
			const config = configurations[integrationId];
			if (!config) {
				this.active.delete(integrationId);
				this.retire(entry);
				continue;
			}

			const fingerprint = connectionFingerprint(config);
			if (entry.fingerprint !== fingerprint) {
				this.replace(integrationId, config, fingerprint, entry);
			}
		}
	}

	async close() {
		const entries = [...this.active.values(), ...this.retiring];
		this.active.clear();
		this.retiring.clear();
		for (const entry of entries) {
			entry.retired = true;
			if (entry.drainTimer) clearTimeout(entry.drainTimer);
		}
		await Promise.all(entries.map((entry) => this.closeEntry(entry)));
	}

	getStats() {
		return {
			active: this.active.size,
			retiring: this.retiring.size,
			leases: [...this.active.values(), ...this.retiring].reduce(
				(total, entry) => total + entry.leases,
				0,
			),
		};
	}

	private replace(
		integrationId: string,
		config: Connection,
		fingerprint: string,
		previous?: Entry,
	) {
		// Create before replacing the map entry: a bad replacement leaves the
		// current known-good client available to requests.
		const connection = this.createConnection(integrationId, config, fingerprint);
		const entry: Entry = {
			integrationId,
			fingerprint,
			connection,
			leases: 0,
			retired: false,
		};
		this.active.set(integrationId, entry);
		if (previous) this.retire(previous);
		return entry;
	}

	private retire(entry: Entry) {
		if (entry.retired) return;
		entry.retired = true;
		this.retiring.add(entry);
		if (entry.leases === 0) {
			void this.closeEntry(entry);
			return;
		}
		entry.drainTimer = setTimeout(() => void this.closeEntry(entry), this.drainTimeoutMs);
	}

	private closeEntry(entry: Entry) {
		if (entry.closePromise) return entry.closePromise;
		if (entry.drainTimer) clearTimeout(entry.drainTimer);
		entry.closePromise = Promise.resolve(entry.connection.close())
			.catch(() => undefined)
			.then(() => {
				this.retiring.delete(entry);
			});
		return entry.closePromise;
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
	});
	return createHash("sha256").update(material).digest("hex");
}

function createManagedConnection(
	_integrationId: string,
	config: Connection,
): ManagedDbConnection {
	if (config.dbType === DbType.POSTGRES) {
		const sql = new SQL({
			adapter: "postgres",
			hostname: config.host,
			port: Number(config.port),
			username: config.username,
			password: config.password,
			database: config.database,
			tls: config.ssl,
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
			connectionLimit: 2,
		});
		return {
			type: DbType.MYSQL,
			db: MySqlAdapter.createKysely(pool),
			pool,
			close: () => pool.promise().end(),
		};
	}

	if (config.dbType === DbType.MONGODB) {
		const client = new MongoClient(buildMongoUrl(config));
		return {
			type: DbType.MONGODB,
			db: client.db(config.database),
			client,
			close: () => client.close(),
		};
	}

	throw new Error(`${config.dbType} Not implemented`);
}
