import { existsSync } from "fs";
import { join } from "path";
import { SQL } from "bun";
import { PGlite } from "@electric-sql/pglite";
import { logger } from "@fluxify/common";

export async function migrateDB(
	db: PGlite | SQL,
	dialect: "pglite" | "postgres",
) {
	logger.info("Initializing production schema migration...");

	const isProduction = process.env.ENVIRONMENT === "production";
	const schemaPath = join(
		isProduction ? process.cwd() : import.meta.dir,
		isProduction ? "" : "../../dist/",
		"schema.sql",
	);

	if (!existsSync(schemaPath)) {
		logger.warn(`schema.sql not found at ${schemaPath}. Skipping migration.`);
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
			logger.info(
				"Database already contains tables. Skipping schema.sql application.",
			);
			return;
		}

		logger.info(`Applying schema from ${schemaPath}...`);
		const schemaSql = await Bun.file(schemaPath).text();

		if (dialect === "postgres") {
			await (db as SQL).unsafe(schemaSql);
		} else {
			await (db as PGlite).exec(schemaSql);
		}

		logger.info("Schema applied successfully.");
	} catch (error) {
		logger.error("CRITICAL: Failed to apply schema.sql migration.", error);
		process.exit(1);
	}
}
