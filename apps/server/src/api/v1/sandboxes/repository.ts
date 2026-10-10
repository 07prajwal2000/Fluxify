import { and, desc, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { sandboxesEntity } from "../../../db/schema";

type SandboxInsert = typeof sandboxesEntity.$inferInsert;

/** everything but the canvas bookkeeping, which the canvas service owns */
const columns = {
	id: sandboxesEntity.id,
	projectId: sandboxesEntity.projectId,
	userId: sandboxesEntity.userId,
	name: sandboxesEntity.name,
	settings: sandboxesEntity.settings,
	createdAt: sandboxesEntity.createdAt,
	updatedAt: sandboxesEntity.updatedAt,
};

export async function insertSandbox(data: SandboxInsert, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.insert(sandboxesEntity)
		.values(data)
		.returning({ id: sandboxesEntity.id });
	return row!.id;
}

export async function findSandbox(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select(columns)
		.from(sandboxesEntity)
		.where(eq(sandboxesEntity.id, id))
		.limit(1);
	return row;
}

/** One user's sandboxes in one project, last edited first. No paging: nobody keeps hundreds. */
export async function listSandboxes(projectId: string, userId: string) {
	return await db
		.select(columns)
		.from(sandboxesEntity)
		.where(and(eq(sandboxesEntity.projectId, projectId), eq(sandboxesEntity.userId, userId)))
		.orderBy(desc(sandboxesEntity.updatedAt));
}

export async function updateSandboxRow(
	id: string,
	data: Partial<SandboxInsert>,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.update(sandboxesEntity)
		.set(data)
		.where(eq(sandboxesEntity.id, id))
		.returning(columns);
	return row!;
}

export async function deleteSandboxRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(sandboxesEntity).where(eq(sandboxesEntity.id, id));
}
