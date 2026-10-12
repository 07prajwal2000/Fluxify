import { eq, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";
import {
	CUSTOM_BLOCK_VERSIONED_FIELDS,
	versionedSettingsChanged,
} from "../../../../modules/versions/state";

type UpdateCustomBlockData = Partial<
	Omit<typeof customBlocksListEntity.$inferInsert, "id" | "projectId" | "name">
>;

export async function getCustomBlockById(id: string, tx?: DbTransactionType) {
	const block = await (tx ?? db)
		.select()
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id))
		.limit(1);
	return block[0];
}

// Removed checkCustomBlockNameExist since name is immutable

export async function updateCustomBlock(
	id: string,
	data: UpdateCustomBlockData,
	tx?: DbTransactionType,
) {
	const conn = tx ?? db;
	// inputs are part of a version (#740): a real change moves the revision, like a canvas save
	const [stored] = await conn
		.select()
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id))
		.for("update");
	const bump = !!stored && versionedSettingsChanged(stored, data, CUSTOM_BLOCK_VERSIONED_FIELDS);
	const updated = await conn
		.update(customBlocksListEntity)
		.set(
			bump ? { ...data, canvasRevision: sql`${customBlocksListEntity.canvasRevision} + 1` } : data,
		)
		.where(eq(customBlocksListEntity.id, id))
		.returning();
	return updated[0];
}
