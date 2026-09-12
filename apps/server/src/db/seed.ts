import { auth } from "../lib/auth";
import { z } from "zod";
import { PgDatabase } from "drizzle-orm/pg-core";
import { initializeLogger, logger } from "@fluxify/common";
import { createSystemUser, getSystemUserByEmail } from "../lib/system-users";
import { getEnv } from "../lib/env";
import { nodeClaimsEntity } from "./schema";
import {
	getInstanceSettingByKey,
	upsertInstanceSetting,
} from "../api/v1/instance-settings/upsert/repository";
import { publishInstanceSetting } from "../loaders/instanceSettingsLoader";

const seedUserSchema = z.object({
	email: z.email(),
	password: z.string().min(8),
});

initializeLogger({ serviceName: "fluxify-server-db-seed" });

/**
 * The claim a fresh deployment needs to serve anything at all.
 *
 * Workers used to be a compose service, so `docker compose up` brought one up
 * on its own. They are claimed now, which means an instance with no claim runs
 * no workers and answers nothing — so the default shape is written once: one
 * catch-all node doing both jobs, which is exactly what the compose `worker`
 * service was and what a community license allows.
 *
 * Seeded by admin rather than the orchestrator because admin owns this table:
 * the orchestrator reads claims and writes node rows, never the other way
 * round (§2). No groups means every group not owned by a dedicated node.
 */
async function seedDefaultClaim(db: PgDatabase<any>) {
	if (getEnv("ORCHESTRATOR_SEED_DEFAULT_CLAIM") === "false") return;
	const existing = await db.select({ id: nodeClaimsEntity.id }).from(nodeClaimsEntity).limit(1);
	if (existing.length) return;

	// The pool ceiling has to come first. It defaults to zero — "the operator
	// has not sized this host yet" — and a claim with no room under it is
	// recorded and left pending, so seeding the claim alone would still leave a
	// fresh instance answering nothing. Two, because that is the ceiling the
	// compose file used to ship (`replicas: 2`); the license is what actually
	// decides how many of them run.
	if (!(await getInstanceSettingByKey("orchestration_pool"))) {
		const value = { maxNodes: 2 };
		await upsertInstanceSetting({ key: "orchestration_pool", category: "orchestration", value });
		await publishInstanceSetting("orchestration_pool", value, false);
		logger.info("seeded the node pool ceiling (2 nodes)");
	}

	await db.insert(nodeClaimsEntity).values({ type: "both", groupIds: [], replicas: 1 });
	logger.info("seeded the default catch-all node claim (1 replica, type both)");
}

export async function seedData(db: PgDatabase<any>) {
	await seedDefaultClaim(db);

	const email = getEnv("SEED_USER_EMAIL");
	const password = getEnv("SEED_USER_PASSWORD");
	const name = getEnv("SEED_USER_NAME") || "Admin User";

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
