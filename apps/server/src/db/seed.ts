import { auth } from "../lib/auth";
import { z } from "zod";
import { PgDatabase } from "drizzle-orm/pg-core";
import { initializeLogger, logger } from "@fluxify/common";
import { createSystemUser, getSystemUserByEmail } from "../lib/system-users";

const seedUserSchema = z.object({
	email: z.email(),
	password: z.string().min(8),
});

initializeLogger({ serviceName: "fluxify-server-db-seed" });

export async function seedData(db: PgDatabase<any>) {
	const email = process.env.SEED_USER_EMAIL;
	const password = process.env.SEED_USER_PASSWORD;
	const name = process.env.SEED_USER_NAME || "Admin User";

	if (!email || !password) {
		logger.warn("No seed user details provided. Skipping seed user creation.");
		return;
	}

	const result = seedUserSchema.safeParse({ email, password });
	if (!result.success) {
		logger.error("Invalid seed user details:", result.error.message);
		return;
	}

	try {
		if (await getSystemUserByEmail(email)) {
			return;
		}

		// canonical row first (admin), then the Better Auth user (hook links by
		// email → shared id).
		await createSystemUser({ email, name, isSystemAdmin: true });
		await auth.api.createUser({
			body: {
				email: result.data.email,
				name,
				password: result.data.password!,
			},
		});

		logger.info(`Seed user created: ${email}`);
	} catch (error) {
		logger.error("Failed to create seed user:", error);
	}
}
