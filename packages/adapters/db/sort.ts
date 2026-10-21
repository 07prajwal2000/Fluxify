import { activeSorts, type DbSort, withTiebreaker } from "@fluxify/sdk/integrations";
import { type JsonSqlDialect, resolveJsonOperand } from "./jsonPath";

export { activeSorts, type DbSort, withTiebreaker };

/** ORDER BY on a Kysely builder; JSON paths sort by their text value, as before. */
export function applySqlSort<B extends { orderBy: Function }>(
	builder: B,
	sorts: DbSort[],
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): B {
	return sorts.reduce(
		(qb, s) =>
			qb.orderBy(resolveJsonOperand(s.attribute, false, dialect, qualifiers) as never, s.direction),
		builder,
	);
}

/** get-single's answer from up to two rows: `strict` refuses a second match */
export function singleRow<T>(rows: T[], strict?: boolean): T | null {
	if (strict && rows.length > 1) {
		throw new Error(
			"expected 1 row, got more: add conditions that match only one, or turn off strict",
		);
	}
	return rows[0] ?? null;
}

/**
 * The sort in entry order, `id` meaning `_id` unless documents have their own
 * `id` (#511); the keys (`_id` unless given) go last as the tiebreaker.
 */
export function mongoSorts(sort: DbSort[], keys: string[] = [], ownId = false): DbSort[] {
	const field = (attribute: string) => (attribute === "id" && !ownId ? "_id" : attribute);
	const sorts = activeSorts(sort).map((s) => ({ ...s, attribute: field(s.attribute) }));
	const own = keys.filter((k) => typeof k === "string" && k.trim());
	return withTiebreaker(sorts, (own.length ? own : ["_id"]).map(field), "");
}

export const sortSpec = (sorts: DbSort[]): Record<string, 1 | -1> =>
	Object.fromEntries(sorts.map((s) => [s.attribute, s.direction === "asc" ? 1 : -1]));
