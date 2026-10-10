import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../../db";
import { projectDevTokensEntity } from "../../../../../db/schema";

/** The sealed token, or undefined when the project has none yet. */
export async function findDevToken(projectId: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ token: projectDevTokensEntity.token })
		.from(projectDevTokensEntity)
		.where(eq(projectDevTokensEntity.projectId, projectId))
		.limit(1);
	return rows[0]?.token;
}

/** Keeps an existing token: two first reads racing must not replace each other's. */
export async function insertDevToken(projectId: string, sealed: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.insert(projectDevTokensEntity)
		.values({ projectId, token: sealed })
		.onConflictDoNothing()
		.returning({ projectId: projectDevTokensEntity.projectId });
	return rows.length > 0;
}

export async function replaceDevToken(projectId: string, sealed: string) {
	await db
		.insert(projectDevTokensEntity)
		.values({ projectId, token: sealed })
		.onConflictDoUpdate({ target: projectDevTokensEntity.projectId, set: { token: sealed } });
}
