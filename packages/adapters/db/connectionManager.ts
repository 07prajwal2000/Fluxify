import { createHash } from "node:crypto";
import {
	LeasedResources,
	type LeasedResourcesOptions,
	type ResourceSpec,
	type ResourceTimer,
} from "@fluxify/lib";
import type { DatabasePool } from "@fluxify/sdk/integrations";
import type { SQL } from "bun";
import type { MongoClient } from "mongodb";
import type { Pool } from "mysql2";
import { databaseVariantFor } from "../integrations";
import type { Connection } from "./connection";

/** A built-in variant's pool carries its driver handles; a plugin's only has to be a `DatabasePool`. */
export type ManagedDbConnection = DatabasePool & {
	type?: string;
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

/** Opens the pooled client through the variant that owns `config.dbType`. */
function createManagedConnection(_integrationId: string, config: Connection): ManagedDbConnection {
	return databaseVariantFor(config.dbType).connect(config) as ManagedDbConnection;
}
