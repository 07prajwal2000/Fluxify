import { literalConnection } from "@fluxify/blocks";
import { BadRequestError } from "../../errors/badRequestError";
import { blockLabel } from "./transactionWiring";

type Block = { id: string; type: string | null; data?: unknown };

/**
 * Refuses joins the block's database cannot run: MySQL has no full join, and
 * MongoDB has no joins yet (#529). A `js:` connection is only known when it
 * runs; MySQL then fails with the same message.
 */
export function assertJoinsSupported(
	blocks: Block[],
	dbTypeOf: (connection: string) => string | undefined,
) {
	const reasons = blocks.flatMap((b) => {
		const joins = (b.data as { joins?: unknown } | null | undefined)?.joins;
		if (!Array.isArray(joins) || joins.length === 0) return [];
		const dbType = dbTypeOf(literalConnection(b.data));
		if (dbType === "mongo") {
			return [`Block ${blockLabel(b)}: MongoDB has no joins yet. Remove them.`];
		}
		const full = joins.some((j) => j?.type === "full" || j?.type === "outer");
		if (dbType === "mysql" && full) {
			return [`Block ${blockLabel(b)}: MySQL has no full join. Use a left or right join.`];
		}
		return [];
	});
	if (reasons.length) throw new BadRequestError(reasons.join(" "));
}
