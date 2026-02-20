import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PgliteDatabase, PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type { BunSQLQueryResultHKT, BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { migrateDB } from "./migration";

let db: PgliteDatabase | BunSQLDatabase = null!;

export async function drizzleInit(migrate: boolean = false) {
  if (process.env.DB_VARIANT === "pglite") {
    const pglite = await initializePgLite();
    migrate && (await migrateDB(pglite, "pglite"));
  } else {
    const pg = await initializePostgres();
    migrate && (await migrateDB(pg, "postgres"));
  }
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
    console.log("db initialized");
  } else {
    throw new Error("db connection failed");
  }

  return client;
}

async function initializePgLite() {
  const drizzlePgLite = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");

  const client = new PGlite(process.env.PGLITE_PATH || "memory://");
  db = drizzlePgLite.drizzle({ client });

  const result = await db.execute<{ connected: number }>(
    "select 1 as connected",
  );
  if (result.rows[0].connected === 1) {
    console.log("pglite db initialized");
  } else {
    throw new Error("db connection failed");
  }

  return client;
}

export { db };

export type DbTransactionType =
  | PgTransaction<
      BunSQLQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >
  | PgTransaction<
      PgliteQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >;
