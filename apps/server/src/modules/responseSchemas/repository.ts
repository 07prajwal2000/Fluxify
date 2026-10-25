import { and, asc, eq, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { routesEntity, routeResponseSchemasEntity as table } from "../../db/schema";

type Conn = DbTransactionType | typeof db;

/** A route's schemas, lowest status code first. */
export async function listResponseSchemas(routeId: string, conn: Conn = db) {
	return await conn
		.select({ statusCode: table.statusCode, schema: table.schema, updatedAt: table.updatedAt })
		.from(table)
		.where(eq(table.routeId, routeId))
		.orderBy(asc(table.statusCode));
}

export async function findRoute(routeId: string) {
	const [route] = await db
		.select({ id: routesEntity.id, projectId: routesEntity.projectId })
		.from(routesEntity)
		.where(eq(routesEntity.id, routeId));
	return route ?? null;
}

/** The route, row-locked, so two schema edits (or an edit and a commit) never interleave. */
export async function lockRoute(routeId: string, tx: DbTransactionType) {
	const [route] = await tx
		.select({ id: routesEntity.id, projectId: routesEntity.projectId })
		.from(routesEntity)
		.where(eq(routesEntity.id, routeId))
		.for("update");
	return route ?? null;
}

/** Schemas are a versioned setting: an edit makes the route read as uncommitted. */
export async function bumpRevision(routeId: string, tx: DbTransactionType) {
	await tx
		.update(routesEntity)
		.set({ canvasRevision: sql`${routesEntity.canvasRevision} + 1` })
		.where(eq(routesEntity.id, routeId));
}

export async function upsertResponseSchema(
	routeId: string,
	statusCode: number,
	schema: Record<string, unknown>,
	tx: DbTransactionType,
) {
	const [row] = await tx
		.insert(table)
		.values({ routeId, statusCode, schema })
		.onConflictDoUpdate({ target: [table.routeId, table.statusCode], set: { schema } })
		.returning({ statusCode: table.statusCode, schema: table.schema, updatedAt: table.updatedAt });
	return row!;
}

export async function deleteResponseSchema(
	routeId: string,
	statusCode: number,
	tx: DbTransactionType,
) {
	const rows = await tx
		.delete(table)
		.where(and(eq(table.routeId, routeId), eq(table.statusCode, statusCode)))
		.returning({ id: table.id });
	return rows.length > 0;
}

/** Checkout: the dev rows become exactly the version's. */
export async function replaceResponseSchemas(
	routeId: string,
	rows: { statusCode: number; schema: Record<string, unknown> }[],
	tx: DbTransactionType,
) {
	await tx.delete(table).where(eq(table.routeId, routeId));
	if (rows.length) await tx.insert(table).values(rows.map((r) => ({ ...r, routeId })));
}
