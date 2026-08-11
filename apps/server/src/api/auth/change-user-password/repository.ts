import { and, eq } from "drizzle-orm";
import { DbTransactionType, db } from "../../../db";
import { account } from "../../../db/auth-schema";

export async function getCredentialAccount(
	userId: string,
	tx?: DbTransactionType,
) {
	const [credentialAccount] = await (tx ?? db)
		.select({ id: account.id })
		.from(account)
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "credential"),
			),
		)
		.limit(1);

	return credentialAccount ?? null;
}

export async function updateCredentialPassword(
	userId: string,
	password: string,
	tx?: DbTransactionType,
) {
	await (tx ?? db)
		.update(account)
		.set({ password })
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "credential"),
			),
		);
}
