import { auth } from "../lib/auth";
import { z } from "zod";
import { DbTransactionType } from "./index";
import { user } from "./auth-schema";
import { eq } from "drizzle-orm";
import { PgDatabase } from "drizzle-orm/pg-core";
import { PgliteDatabase } from "drizzle-orm/pglite";

const seedUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function seedData(db: PgDatabase<any> | PgliteDatabase<any>) {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  const name = process.env.SEED_USER_NAME || "Admin User";

  if (!email || !password) {
    console.log("No seed user details provided. Skipping seed user creation.");
    return;
  }

  const result = seedUserSchema.safeParse({ email, password });
  if (!result.success) {
    console.error("Invalid seed user details:", result.error.message);
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

    console.log(`Seed user created: ${email}`);
  } catch (error) {
    console.error("Failed to create seed user:", error);
  }
}
