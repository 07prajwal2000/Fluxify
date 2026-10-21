import { initializeLogger, logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	getInstanceSettingByKey,
	upsertInstanceSetting,
} from "../api/v1/instance-settings/upsert/repository";
import { auth } from "../lib/auth";
import { getEnv } from "../lib/env";
import { createSystemUser, deleteSystemUser, getSystemUserByEmail } from "../lib/system-users";
import { publishInstanceSetting } from "../loaders/instanceSettingsLoader";
import { recordEvent } from "../modules/orchestrator/records";
import { account } from "./auth-schema";
import { nodeClaimsEntity } from "./schema";

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
 *
 * **Once per instance, not once per empty table.** This runs on every admin
 * boot, and an instance with no claims is not only a new one — it is also one
 * whose operator released the last claim on purpose. Re-seeding that put a
 * claim nobody asked for back in the database on the next restart, and the
 * reconciler then kept recreating its container: deleting the container or its
 * broker record only made it come back. The pool setting this function writes
 * is the mark that seeding already happened.
 */
async function seedDefaultClaim(db: PgDatabase<any>) {
	if (getEnv("ORCHESTRATOR_SEED_DEFAULT_CLAIM") === "false") return;
	// The pool ceiling has to come first. It defaults to zero — "the operator
	// has not sized this host yet" — and a claim with no room under it is
	// recorded and left pending, so seeding the claim alone would still leave a
	// fresh instance answering nothing. Two, because that is the ceiling the
	// compose file used to ship (`replicas: 2`); the license is what actually
	// decides how many of them run.
	if (await getInstanceSettingByKey("orchestration_pool")) return;
	const existing = await db.select({ id: nodeClaimsEntity.id }).from(nodeClaimsEntity).limit(1);
	if (existing.length) return;

	const value = { maxNodes: 2 };
	await upsertInstanceSetting({ key: "orchestration_pool", category: "orchestration", value });
	await publishInstanceSetting("orchestration_pool", value, false);
	logger.info("seeded the node pool ceiling (2 nodes)");

	const [claim] = await db
		.insert(nodeClaimsEntity)
		.values({ type: "both", groupIds: [], replicas: 1 })
		.returning({ id: nodeClaimsEntity.id });
	// Recorded like any other claim, because the history is where a person
	// looks to find out why a container exists — and a claim with no event
	// behind it is the one nobody can account for.
	await recordEvent({
		claimId: claim!.id,
		projectId: null,
		action: "claim_created",
		detail: { type: "both", groupIds: [], replicas: 1, actor: "seed" },
	});
	logger.info("seeded the default catch-all node claim (1 replica, type both)");
}

/**
 * A seed user is only usable once Better Auth has an account for it. The
 * canonical row alone (all a failed first start leaves behind) is why every
 * later boot skipped the seed and no login was ever retried (#885).
 */
async function hasLoginAccount(db: PgDatabase<any>, userId: string) {
	const [row] = await db
		.select({ id: account.id })
		.from(account)
		.where(eq(account.userId, userId))
		.limit(1);
	return Boolean(row);
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

	let createdId: string | undefined;
	try {
		const existing = await getSystemUserByEmail(email);
		if (existing && (await hasLoginAccount(db, existing.id))) {
			return;
		}

		// Canonical row first (admin), then the Better Auth user: the user.create
		// hook links it by email → shared id and refuses an unprovisioned email.
		// A row left behind by a failed start is reused rather than duplicated.
		if (!existing) {
			const created = await createSystemUser({ email, name, isSystemAdmin: true });
			createdId = created.id;
		}
		await auth.api.createUser({
			body: {
				email: result.data.email,
				name,
				password: result.data.password!,
			},
		});

		logger.info(`Seed user created: ${email}`);
	} catch (error) {
		// Without this, a failed first start poisons the volume: the lookup above
		// finds the canonical row on every later boot and the login is never
		// retried. Roll it back so the next start seeds cleanly.
		if (createdId) {
			await deleteSystemUser(createdId).catch((rollbackError) =>
				logger.error("Failed to roll back the seed user:", rollbackError),
			);
		}
		logger.error("Failed to create seed user:", error);
	}
}
