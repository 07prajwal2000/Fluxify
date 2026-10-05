import { literalConnection } from "@fluxify/blocks";
import { BadRequestError } from "../../errors/badRequestError";
import { blockLabel } from "./transactionWiring";

type Block = { id: string; type: string | null; data?: unknown };

/**
 * Refuses joins the block's database cannot run: MySQL has no full join. A
 * `js:` connection is only known when it runs; MySQL then fails with the same
 * message. MongoDB skips joins instead (#529), so a block switched from SQL
 * keeps them for when it switches back.
 */
export function assertJoinsSupported(
	blocks: Block[],
	dbTypeOf: (connection: string) => string | undefined,
) {
	const reasons = blocks.flatMap((b) => {
		const joins = (b.data as { joins?: unknown } | null | undefined)?.joins;
		if (!Array.isArray(joins) || joins.length === 0) return [];
		const dbType = dbTypeOf(literalConnection(b.data));
		const full = joins.some((j) => j?.type === "full" || j?.type === "outer");
		if (dbType === "mysql" && full) {
			return [`Block ${blockLabel(b)}: MySQL has no full join. Use a left or right join.`];
		}
		return [];
	});
	if (reasons.length) throw new BadRequestError(reasons.join(" "));
}
