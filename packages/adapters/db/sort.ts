import { type JsonSqlDialect, resolveJsonOperand } from "./jsonPath";

/** One ORDER BY entry; a list sorts by the first entry, then the next on ties. */
export type DbSort = { attribute: string; direction: "asc" | "desc" };

/**
 * The entries to apply. One whose column is undefined at run time is skipped,
 * so a sort read from an optional query param needs no branching. A blank
 * column is refused: the database would only fail on it less clearly.
 */
export function activeSorts(sort: DbSort[] = []): DbSort[] {
	return sort.filter((entry, i) => {
		if (entry.attribute === undefined || entry.attribute === null) return false;
		if (typeof entry.attribute !== "string" || !entry.attribute.trim()) {
			throw new Error(`sort ${i + 1} has no column`);
		}
		return true;
	});
}

/**
 * Appends the key columns not already sorted on. Rows that tie on every sort
 * column otherwise come back in any order, and offset paging then repeats or
 * skips rows. `table.key` and `key` count as the same column; with joins the
 * key is qualified, since a joined table may have a column of the same name.
 */
export function withTiebreaker(
	sorts: DbSort[],
	keys: string[],
	table: string,
	joined = false,
): DbSort[] {
	const bare = (column: string) =>
		column.startsWith(`${table}.`) ? column.slice(table.length + 1) : column;
	const sorted = new Set(sorts.map((s) => bare(s.attribute)));
	const missing = keys.filter((key) => !sorted.has(key));
	return [
		...sorts,
		...missing.map((key) => ({
			attribute: joined ? `${table}.${key}` : key,
			direction: "asc" as const,
		})),
	];
}

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
