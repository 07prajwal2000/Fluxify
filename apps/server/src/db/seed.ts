import { auth } from "../lib/auth";
import { z } from "zod";
import { user } from "./auth-schema";
import { eq } from "drizzle-orm";
import { PgDatabase } from "drizzle-orm/pg-core";
import { PgliteDatabase } from "drizzle-orm/pglite";
import { initializeLogger, logger } from "@fluxify/common";

const seedUserSchema = z.object({
	email: z.email(),
	password: z.string().min(8),
});

initializeLogger({ serviceName: "fluxify-server-db-seed" });

export async function seedData(db: PgDatabase<any> | PgliteDatabase<any>) {
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
		const existingUser = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email))
			.limit(1);

		if (existingUser.length > 0) {
			return;
		}

		await auth.api.createUser({
			body: {
				email: result.data.email,
				name,
				password: result.data.password!,
				data: {
					isSystemAdmin: true,
				},
			},
		});

		logger.info(`Seed user created: ${email}`);
	} catch (error) {
		logger.error("Failed to create seed user:", error);
	}
}
