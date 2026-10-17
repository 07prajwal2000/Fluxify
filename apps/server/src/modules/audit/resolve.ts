import { eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { type DbTransactionType, db } from "../../db";

/**
 * Looks up the project a row belongs to, for `audit.record({ projectId })`.
 * Pass the result as the function it is, so the query only runs once the audit
 * gate has passed.
 */
export const projectIdOf =
	(table: PgTable & { id: any; projectId: any }, id: string, tx?: DbTransactionType) =>
	async () => {
		const [row] = await (tx ?? db)
			.select({ projectId: table.projectId })
			.from(table)
			.where(eq(table.id, id))
			.limit(1);
		return (row?.projectId as string | null | undefined) ?? null;
	};
