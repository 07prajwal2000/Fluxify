import { existsSync } from "fs";
import { join } from "path";
import { SQL } from "bun";
import { PGlite } from "@electric-sql/pglite";

export async function migrateDB(
  db: PGlite | SQL,
  dialect: "pglite" | "postgres",
) {
  console.log("Initializing production schema migration...");

  const isProduction = process.env.ENVIRONMENT === "production";
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
    let result: any;

    const tableCountQuery = `
      SELECT count(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    if (dialect === "postgres") {
      result = await (db as SQL).unsafe(tableCountQuery);
    } else {
      result = await (db as PGlite).query(tableCountQuery);
    }

    const tableCount = parseInt(result[0]!.count.toString());

    if (tableCount > 0) {
      console.log(
        "Database already contains tables. Skipping schema.sql application.",
      );
      return;
    }

    console.log(`Applying schema from ${schemaPath}...`);
    const schemaSql = await Bun.file(schemaPath).text();

    if (dialect === "postgres") {
      await (db as SQL).unsafe(schemaSql);
    } else {
      await (db as PGlite).exec(schemaSql);
    }

    console.log("Schema applied successfully.");
  } catch (error) {
    console.error("CRITICAL: Failed to apply schema.sql migration.", error);
    process.exit(1);
  }
}
