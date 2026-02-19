import { existsSync } from "fs";
import { join } from "path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

export async function migrateDB(
  db: PGlite | Pool,
  dialect: "pglite" | "postgres",
) {
  // Only run in production
  const isProduction = process.env.ENVIRONMENT === "production";
  console.log("Initializing production schema migration...");
  const schemaPath = join(
    isProduction ? process.cwd() : import.meta.dir,
    isProduction ? "" : "../../dist/",
    "schema.sql",
  );

  if (!existsSync(schemaPath)) {
    console.warn(`schema.sql not found at ${schemaPath}. Skipping migration.`);
    return;
  }

  try {
    let result: any = undefined;
    if (dialect === "postgres") {
      result = await (db as Pool).query(`
      SELECT count(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    } else {
      result = await (db as PGlite).query(`
      SELECT count(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    }

    // @ts-ignore
    const tableCount = parseInt(result.rows[0]!.count.toString());

    if (tableCount > 0) {
      console.log(
        "Database already contains tables. Skipping schema.sql application.",
      );
      return;
    }

    console.log(`Applying schema from ${schemaPath}...`);
    const schemaSql = await Bun.file(schemaPath).text();

    dialect === "postgres"
      ? await (db as Pool).query(schemaSql)
      : await (db as PGlite).exec(schemaSql);

    console.log("Schema applied successfully.");
  } catch (error) {
    console.error("CRITICAL: Failed to apply schema.sql migration.", error);
    process.exit(1);
  }
}
