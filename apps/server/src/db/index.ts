import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { BunSQLQueryResultHKT, BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { migrateDB } from "./migration";
import { logger } from "@fluxify/common";

let db: BunSQLDatabase = null!;

export async function drizzleInit(migrate: boolean = false) {
	const pg = await initializePostgres();
	migrate && (await migrateDB(pg));
	return db;
}

async function initializePostgres() {
	const pgUrl = process.env.PG_URL;
	if (!pgUrl) {
		throw new Error("postgres connection url is required for drizzle");
	}

	const client = new SQL(pgUrl);
	db = drizzle({ client });

	const result = await db.execute<{ connected: number }>(
		`select 1 as connected`,
	);
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

