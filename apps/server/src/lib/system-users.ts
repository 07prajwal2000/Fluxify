import { db, DbTransactionType } from "../db";
import { systemUsers } from "../db/auth-schema";
import { desc, eq, ilike, or, sql } from "drizzle-orm";

// Canonical user table. All app code goes through here — never the Better Auth
// `user` table directly.

export async function createSystemUser(
	data: { email: string; name?: string | null; isSystemAdmin?: boolean },
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.insert(systemUsers)
		.values({
			email: data.email.toLowerCase(),
			name: data.name ?? null,
			isSystemAdmin: data.isSystemAdmin ?? false,
		})
		.returning();
	return row;
}

export async function getSystemUserByEmail(
	email: string,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.select()
		.from(systemUsers)
		.where(eq(systemUsers.email, email.toLowerCase()));
	return row ?? null;
}

export async function getSystemUserById(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select()
		.from(systemUsers)
		.where(eq(systemUsers.id, id));
	return row ?? null;
}

export async function listSystemUsers(
	skip: number,
	limit: number,
	fuzzyTextSearch?: string,
	tx?: DbTransactionType,
) {
	return (tx ?? db)
		.select({
			id: systemUsers.id,
			name: systemUsers.name,
			email: systemUsers.email,
			isSystemAdmin: systemUsers.isSystemAdmin,
		})
		.from(systemUsers)
		.where(
			fuzzyTextSearch
				? or(
						ilike(systemUsers.name, `%${fuzzyTextSearch}%`),
						ilike(systemUsers.email, `%${fuzzyTextSearch}%`),
					)
				: undefined,
		)
		.limit(limit)
		.offset(skip)
		.orderBy(desc(systemUsers.createdAt));
}

export async function countSystemUsers(tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ count: sql<number>`count(*)` })
		.from(systemUsers);
	return row.count;
}

export async function setSystemUserAdmin(
	id: string,
	isSystemAdmin: boolean,
	tx?: DbTransactionType,
) {
	await (tx ?? db)
		.update(systemUsers)
		.set({ isSystemAdmin })
		.where(eq(systemUsers.id, id));
}

// Deleting the system user cascades the Better Auth user + account/session.
export async function deleteSystemUser(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(systemUsers).where(eq(systemUsers.id, id));
}
