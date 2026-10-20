import { and, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { pluginsEntity } from "../../db/schema";

type Conn = DbTransactionType | typeof db;
export type PluginRecord = typeof pluginsEntity.$inferSelect;
export type PluginInsert = typeof pluginsEntity.$inferInsert;

export const listPluginRows = (projectId: string, tx: Conn = db) =>
	tx.select().from(pluginsEntity).where(eq(pluginsEntity.projectId, projectId));

export async function getPluginRow(projectId: string, name: string, tx: Conn = db) {
	const [row] = await tx
		.select()
		.from(pluginsEntity)
		.where(and(eq(pluginsEntity.projectId, projectId), eq(pluginsEntity.name, name)));
	return row as PluginRecord | undefined;
}

export async function insertPluginRow(values: PluginInsert, tx: Conn = db) {
	const [row] = await tx.insert(pluginsEntity).values(values).returning();
	return row!;
}

export async function updatePluginRow(id: string, values: Partial<PluginInsert>, tx: Conn = db) {
	const [row] = await tx
		.update(pluginsEntity)
		.set(values)
		.where(eq(pluginsEntity.id, id))
		.returning();
	return row!;
}
