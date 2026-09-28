import { type RawBuilder, type SelectQueryBuilder, sql } from "kysely";
import {
	BSON,
	type Collection,
	type Document,
	type Filter,
	type FindOptions,
	type WithId,
} from "mongodb";
import { applyColumns, type JsonSqlDialect, resolveColumnRef } from "./jsonPath";
import { applySqlSort, type DbSort, sortSpec, withTiebreaker } from "./sort";

/**
 * Cursor paging. `after` is the previous page's `nextCursor` (none for the
 * first page); `keys` are the columns that break ties, unique together.
 */
export type DbCursor = { after?: string | null; keys?: string[] };
export type DbPage = { rows: unknown[]; nextCursor: string | null };

/** opaque to the graph; EJSON brings Dates and ObjectIds back as themselves, not as text */
function encodeCursor(values: unknown[]): string {
	return Buffer.from(BSON.EJSON.stringify(values, { relaxed: true })).toString("base64url");
}

export function decodeCursor(after: string, sortCount: number): unknown[] {
	let values: unknown;
	try {
		values = BSON.EJSON.parse(Buffer.from(after, "base64url").toString("utf8"), { relaxed: true });
	} catch {}
	if (!Array.isArray(values) || values.length !== sortCount) {
		throw new Error(
			"after is not a cursor for this sort: pass back the nextCursor of the previous page, unchanged",
		);
	}
	return values;
}

/**
 * The sort the cursor walks: the user's, then the tiebreaker keys, or the
 * primary key when none are set. Without columns that are unique together,
 * rows that tie on every sort column would be skipped between pages.
 */
export function cursorSorts(
	sorts: DbSort[],
	keys: string[] | undefined,
	primaryKey: string[],
	table: string,
	joined: boolean,
): DbSort[] {
	const own = (keys ?? []).filter((k) => typeof k === "string" && k.trim());
	if (own.length) return withTiebreaker(sorts, own, table);
	if (!primaryKey.length) {
		throw new Error(
			"cursor paging needs columns that are unique together: this table has no primary key, so add them under Tiebreaker columns",
		);
	}
	return withTiebreaker(sorts, primaryKey, table, joined);
}

/**
 * Whether a sort puts nulls after the values. Postgres treats null as larger
 * than every value, MySQL and MongoDB as smaller, so it flips with direction.
 */
export function nullsComeAfter(sort: DbSort, nullsLarge: boolean): boolean {
	return (sort.direction === "asc") === nullsLarge;
}

/** the page and the cursor for the next one; a row past the limit tells that one exists */
export async function toPage<R>(
	rows: R[],
	limit: number | null,
	values: (last: R) => unknown[] | Promise<unknown[]>,
): Promise<{ rows: R[]; nextCursor: string | null }> {
	if (limit === null || rows.length <= limit) return { rows, nextCursor: null };
	const page = rows.slice(0, limit);
	return { rows: page, nextCursor: encodeCursor(await values(page[page.length - 1])) };
}

/** one sort column strictly past `value` in sort order; null when nothing can be */
function sqlPast(expr: RawBuilder<unknown>, value: unknown, sort: DbSort, nullsLarge: boolean) {
	const nullsAfter = nullsComeAfter(sort, nullsLarge);
	if (value === null) return nullsAfter ? null : sql`${expr} IS NOT NULL`;
	const past = sql`${expr} ${sql.raw(sort.direction === "asc" ? ">" : "<")} ${value}`;
	return nullsAfter ? sql`(${past} OR ${expr} IS NULL)` : past;
}

/** rows after the cursor: `a > x OR (a = x AND b > y) OR ...`, which any mix of directions can take */
function sqlAfter(
	exprs: RawBuilder<unknown>[],
	sorts: DbSort[],
	values: unknown[],
	nullsLarge: boolean,
) {
	const branches = sorts.flatMap((sort, i) => {
		const past = sqlPast(exprs[i], values[i], sort, nullsLarge);
		if (!past) return [];
		const ties = exprs
			.slice(0, i)
			.map((e, j) => (values[j] === null ? sql`${e} IS NULL` : sql`${e} = ${values[j]}`));
		return [sql`(${sql.join([...ties, past], sql` AND `)})`];
	});
	return branches.length ? sql<boolean>`(${sql.join(branches, sql` OR `)})` : sql<boolean>`1 = 0`;
}

const KEY = "__fx_cursor_";

/**
 * A cursor page on Postgres or MySQL. The sort values are selected under
 * hidden names, so the cursor works when Columns leaves them out or a sort is a
 * JSON path, and are dropped before the rows are returned.
 */
export async function sqlPage(
	qb: SelectQueryBuilder<any, any, any>,
	sorts: DbSort[],
	limit: number | null,
	after: string | null | undefined,
	columns: string[] | undefined,
	dialect: JsonSqlDialect,
	qualifiers: Set<string>,
): Promise<DbPage> {
	const exprs = sorts.map(
		(s) => resolveColumnRef(s.attribute, false, dialect, qualifiers) as RawBuilder<unknown>,
	);
	if (after) {
		const values = decodeCursor(after, sorts.length);
		qb = qb.where(sqlAfter(exprs, sorts, values, dialect === "postgres"));
	}
	let q = exprs.reduce(
		(b, e, i) => b.select(sql`${e}`.as(`${KEY}${i}`)),
		applyColumns(qb, columns),
	);
	q = applySqlSort(q, sorts, dialect, qualifiers);
	if (limit !== null) q = q.limit(limit + 1);

	const rows = (await q.execute()) as Record<string, unknown>[];
	const page = await toPage(rows, limit, (row) => sorts.map((_, i) => row[`${KEY}${i}`]));
	for (const row of page.rows) for (let i = 0; i < sorts.length; i++) delete row[`${KEY}${i}`];
	return page;
}

/** a dot path's value in a raw document; missing is null, as Mongo sorts it */
function valueAt(doc: unknown, path: string): unknown {
	return path.split(".").reduce<any>((v, key) => (v == null ? undefined : v[key]), doc) ?? null;
}

/** one sort field strictly past `value` in sort order; null when nothing can be */
function mongoPast(sort: DbSort, value: unknown): Record<string, unknown> | null {
	const field = sort.attribute;
	const nullsAfter = nullsComeAfter(sort, false);
	if (value === null) return nullsAfter ? null : { [field]: { $ne: null } };
	const past = { [field]: { [sort.direction === "asc" ? "$gt" : "$lt"]: value } };
	return nullsAfter ? { $or: [past, { [field]: { $eq: null } }] } : past;
}

/** documents after the cursor, the same shape as on SQL: `a > x OR (a = x AND b > y) OR ...` */
function mongoAfter(sorts: DbSort[], values: unknown[]): Record<string, unknown> {
	const branches = sorts.flatMap((sort, i) => {
		const past = mongoPast(sort, values[i]);
		if (!past) return [];
		const ties = sorts.slice(0, i).map((s, j) => ({ [s.attribute]: { $eq: values[j] } }));
		return [{ $and: [...ties, past] }];
	});
	// nothing sorts after the cursor, and no document lacks an _id
	return branches.length ? { $or: branches } : { _id: { $exists: false } };
}

/** a cursor page on MongoDB; the documents come back raw, for the adapter to map */
export async function mongoPage(
	collection: Collection,
	filter: Filter<Document>,
	findOptions: FindOptions,
	sorts: DbSort[],
	limit: number | null,
	after: string | null | undefined,
): Promise<{ rows: WithId<Document>[]; nextCursor: string | null }> {
	const past = after ? mongoAfter(sorts, decodeCursor(after, sorts.length)) : {};
	const found = collection.find({ $and: [filter, past] }, findOptions).sort(sortSpec(sorts));
	const docs = await (limit === null ? found : found.limit(limit + 1)).toArray();
	return toPage(docs, limit, async (last) => {
		// Columns may have left the sort fields out of the page; read them by _id
		const full = findOptions.projection
			? await collection.findOne({ _id: last._id }, { session: findOptions.session })
			: last;
		return sorts.map((s) => valueAt(full, s.attribute));
	});
}
