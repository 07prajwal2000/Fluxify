import { and, eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import type {
	customBlocksListEntity,
	integrationsEntity,
	middlewaresEntity,
} from "../../db/schema";

type NamedTable =
	| typeof middlewaresEntity
	| typeof customBlocksListEntity
	| typeof integrationsEntity;

/** id → name for rows of `table`, so references can travel by name */
export async function namesOf(
	table: NamedTable,
	ids: string[],
	tx: DbTransactionType | typeof db = db,
) {
	if (ids.length === 0) return new Map<string, string>();
	const rows = await tx
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(inArray(table.id, ids));
	return new Map(rows.map((r) => [r.id, r.name ?? ""]));
}

/** name → id of the project's rows of `table`, for the names asked for */
export async function idsByName(
	table: NamedTable,
	projectId: string,
	names: string[],
): Promise<Map<string, string>> {
	if (names.length === 0) return new Map();
	const rows = await db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(and(eq(table.projectId, projectId), inArray(table.name, names)));
	return new Map(rows.map((r) => [r.name ?? "", r.id]));
}
