import { logger } from "@fluxify/common";
import { SQL } from "bun";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { BunSQLDatabase, BunSQLQueryResultHKT } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/bun-sql";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { getEnv } from "../lib/env";
import { migrateDB } from "./migration";

let db: BunSQLDatabase = null!;

export async function drizzleInit(migrate: boolean = false) {
	const pg = await initializePostgres();
	migrate && (await migrateDB(pg));
	return db;
}

async function initializePostgres() {
	const pgUrl = getEnv("PG_URL");
	if (!pgUrl) {
		throw new Error("postgres connection url is required for drizzle");
	}

	const client = new SQL(pgUrl);
	db = drizzle({ client });

	// Retried at startup (#463): a failed attempt must not leave its client behind.
	const result = await db
		.execute<{ connected: number }>(`select 1 as connected`)
		.catch(async (error) => {
			await client.close().catch(() => {});
			throw error;
		});
	if (result[0].connected) {
		logger.info("postgres database initialized");
	} else {
		throw new Error("db connection failed");
	}

	return client;
}

export { db };

export type DbTransactionType = PgTransaction<
	BunSQLQueryResultHKT,
	Record<string, never>,
	ExtractTablesWithRelations<Record<string, never>>
>;

export * from "./agent-harness-schema";
