import { logger } from "@fluxify/common";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { join } from "path";
import { FatalStartupError } from "../lib/waitFor";
import { adoptExistingDatabase } from "./adoptBaseline";

// src/db/migrations in dev; in the admin image the build copies it next to the
// bundle (dist/migrations), and import.meta.dir is the bundle's directory.
export const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

// Any fixed number, the same on every admin replica: whoever holds it migrates,
// the rest wait and then find nothing left to do.
const MIGRATION_LOCK = 603_603;

/**
 * Applies the migrations this database has not had yet, in order, once. The
 * migrator runs them all in one transaction, so a failure leaves the database
 * as it was and stops the server.
 */
export async function migrateDB(url: string, migrationsFolder = MIGRATIONS_FOLDER) {
	// One connection: a session-level advisory lock only holds on the
	// connection that took it.
	const client = new SQL(url, { max: 1 });
	try {
		await client`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
		await adoptExistingDatabase(client, migrationsFolder);
		await migrate(drizzle({ client }), { migrationsFolder });
		logger.info("database migrations are up to date");
	} catch (error) {
		const cause = (error as Error)?.cause;
		throw new FatalStartupError(
			`database migration failed and was rolled back: ${String(error)}${cause ? ` (${String(cause)})` : ""}`,
			{ cause: error },
		);
	} finally {
		await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`.catch(() => {});
		await client.close();
	}
}
