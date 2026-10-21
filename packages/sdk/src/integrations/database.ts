import z from "zod";

// --- Condition Operators & Schemas ---

/** operators that compare against nothing, so a condition using one has no value */
export const DB_VALUELESS_OPERATORS = ["is_null", "is_not_null", "exists", "not_exists"] as const;

/**
 * The database WHERE operators. Kept apart from generic operator schemas:
 * `between` or `starts_with` apply specifically to queries.
 */
export const dbOperatorSchema = z
	.enum([
		"eq",
		"neq",
		"gt",
		"gte",
		"lt",
		"lte",
		"in",
		"not_in",
		"contains",
		"starts_with",
		"ends_with",
		"between",
		...DB_VALUELESS_OPERATORS,
	])
	.describe(
		"eq/neq/gt/gte/lt/lte compare; in/not_in take a list (array or comma-separated text); between takes [min, max], both included; contains/starts_with/ends_with match text, ignoring case; is_null/is_not_null and exists/not_exists (MongoDB only) take no value.",
	);

export type DbOperator = z.infer<typeof dbOperatorSchema>;

/** opt-in tag that makes a side name a column instead of holding a value */
export const columnRefSchema = z.object({
	kind: z.literal("column"),
	value: z.string(),
});

/** the mirror tag: a side that holds a value where a column is the default */
export const literalRefSchema = z.object({
	kind: z.literal("literal"),
	value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
});

export const structuredWhereConditionSchema = z.object({
	// untagged: a column, which is what an attribute is by position
	attribute: z.union([z.string(), columnRefSchema, literalRefSchema]),
	operator: dbOperatorSchema,
	// untagged: a literal, so a dotted value is never read as a column path.
	// Absent for is_null / is_not_null / exists / not_exists.
	value: z.union([z.string(), z.number(), columnRefSchema, literalRefSchema]).optional(),
	chain: z.enum(["and", "or"]),
});

/**
 * A hand-written condition, already evaluated by the block: SQL adapters get
 * `{ strings, values }` (the text around each `{{ }}` and the bound values),
 * MongoDB gets the filter object the user's JS returned.
 */
export const rawWhereConditionSchema = z.object({
	operator: z.literal("raw"),
	raw: z.unknown(),
	chain: z.enum(["and", "or"]),
});

export type RawDbCondition = z.infer<typeof rawWhereConditionSchema>;
/** brackets: the group's conditions combine first, then join the list like one condition */
export type DbConditionGroup = { group: DBConditionType[]; chain: "and" | "or" };
export type DBConditionType =
	| z.infer<typeof structuredWhereConditionSchema>
	| RawDbCondition
	| DbConditionGroup;

export const whereConditionSchema: z.ZodType<DBConditionType> = z.union([
	structuredWhereConditionSchema,
	rawWhereConditionSchema,
	z.object({
		get group() {
			return z.array(whereConditionSchema);
		},
		chain: z.enum(["and", "or"]),
	}),
]);

// --- Connection & Options Types ---

export enum DbType {
	POSTGRES = "pg",
	MONGODB = "mongo",
	MYSQL = "mysql",
}

export interface Connection {
	dbType: DbType;
	username: string;
	password: string;
	host: string;
	port: string | number;
	database: string;
	ssl?: boolean;
	/** a query running longer is stopped; unset means DEFAULT_QUERY_TIMEOUT_MS */
	queryTimeoutMs?: number;
	/** most connections the pool opens, per worker; unset means DEFAULT_MAX_CONNECTIONS */
	maxConnections?: number;
}

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CONNECTIONS: Record<DbType, number> = {
	[DbType.POSTGRES]: 10,
	[DbType.MYSQL]: 10,
	[DbType.MONGODB]: 100,
};
/** the most a user may set, per worker: past this a worker spends its memory on idle sockets */
export const MAX_MAX_CONNECTIONS: Record<DbType, number> = {
	[DbType.POSTGRES]: 50,
	[DbType.MYSQL]: 50,
	[DbType.MONGODB]: 100,
};

export type IsolationLevel = "read_committed" | "repeatable_read" | "serializable";

/** " ISOLATION LEVEL ..." for BEGIN / SET TRANSACTION, "" for the database default */
export function isolationClause(isolation?: IsolationLevel) {
	return isolation ? ` ISOLATION LEVEL ${isolation.replace("_", " ").toUpperCase()}` : "";
}

// --- Cursor & Paging Types ---

/**
 * Cursor paging. `after` is the previous page's `nextCursor` (none for the
 * first page); `keys` are the columns that break ties, unique together.
 */
export type DbCursor = { after?: string | null; keys?: string[] };
export type DbPage = { rows: unknown[]; nextCursor: string | null };

// --- Sort Types & Pure Helpers ---

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

// --- Joins & Query Options ---

export type DBJoinType = {
	table: string;
	alias?: string;
	/** the ON clause: the same condition list as WHERE */
	on: DBConditionType[];
	type?: "inner" | "left" | "right" | "full";
};

/**
 * `sort` and `strict` are read by getSingle; getAll takes its sort as a
 * parameter. `strict`: more than one matching row is an error, not a pick.
 */
export type QueryOptions = {
	joins?: DBJoinType[];
	sort?: DbSort[];
	strict?: boolean;
	select?: string[];
	columns?: string[];
};

// --- JSON Path Helpers ---

function parsePath(
	raw: string,
): { column: string; segments: { key: string; index: boolean }[] } | null {
	const head = raw.match(/^([^.[]+)(.*)$/);
	if (!head || head[2] === "" || /^\d+$/.test(head[1])) return null;

	const rest = head[2];
	const segments: { key: string; index: boolean }[] = [];
	const re = /\.([^.[]+)|\[(\d+)\]/g;
	let consumed = 0;
	for (let m = re.exec(rest); m; m = re.exec(rest)) {
		consumed = re.lastIndex;
		if (m[1] !== undefined) segments.push({ key: m[1], index: false });
		else segments.push({ key: m[2], index: true });
	}
	if (consumed !== rest.length || segments.length === 0) return null;
	return { column: head[1], segments };
}

/** Converts a JS-style accessor to a MongoDB dot-path. */
export function toMongoField(attribute: string): string {
	const parsed = parsePath(attribute);
	if (!parsed) return attribute;
	return [parsed.column, ...parsed.segments.map((s) => s.key)].join(".");
}

export function isNumericLike(v: unknown): boolean {
	if (typeof v === "number") return Number.isFinite(v);
	if (typeof v === "string") return v.trim() !== "" && !isNaN(Number(v));
	return false;
}

// --- Upsert & Conflict Types & Helpers ---

/** insert-or-update on a unique key; `update` left out means every inserted column except `target` */
export type OnConflict = {
	target: string[];
	action: "update" | "ignore";
	update?: string[];
};

/** the columns an upsert overwrites */
export function conflictUpdateColumns(rows: object[], onConflict: OnConflict): string[] {
	if (onConflict.update) return onConflict.update;
	const columns = new Set(rows.flatMap((r) => Object.keys(r)));
	for (const c of onConflict.target) columns.delete(c);
	return [...columns];
}

/** each row's `target` values; every row needs them to be matched and read back */
export function conflictKeys(rows: Record<string, any>[], target: string[]) {
	return rows.map((row) =>
		Object.fromEntries(
			target.map((c) => {
				if (row[c] === undefined) throw new Error(`upsert: a row has no value for "${c}"`);
				return [c, row[c]];
			}),
		),
	);
}

// --- Counter Types & Helpers ---

/**
 * `{ op: "inc" | "dec", value }` as a column's value: the database adds to what it holds.
 */
export type CounterOp = { op: "inc" | "dec"; value: unknown };

export function isCounterOp(value: unknown): value is CounterOp {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const { op } = value as { op?: unknown };
	return Object.keys(value).length === 2 && "value" in value && (op === "inc" || op === "dec");
}

/** the signed amount; it is always sent as a bound parameter, so it must be a real number */
export function counterDelta(column: string, counter: CounterOp): number {
	const { op, value } = counter;
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${op} on "${column}" needs a number, got ${JSON.stringify(value)}`);
	return op === "inc" ? value : -value;
}

// --- Introspection & Schema Describe ---

export type IntrospectedColumn = {
	name: string;
	type: string;
	/** table that owns the column — the referenced table for a foreign key, else the column's own table */
	owner: string;
};

export type IntrospectedTable = {
	table: string;
	columns: IntrospectedColumn[];
};

/** groups flat information_schema rows into the IntrospectedTable shape */
export function groupIntrospectionRows(
	rows: Array<{
		table_name: string;
		column_name: string;
		data_type: string;
		ref_table: string | null;
	}>,
): IntrospectedTable[] {
	const byTable = new Map<string, IntrospectedTable>();
	for (const r of rows) {
		let entry = byTable.get(r.table_name);
		if (!entry) {
			entry = { table: r.table_name, columns: [] };
			byTable.set(r.table_name, entry);
		}
		entry.columns.push({
			name: r.column_name,
			type: r.data_type,
			owner: r.ref_table ?? r.table_name,
		});
	}
	return [...byTable.values()];
}

/** rows per bulk INSERT: at most 1000, and wide rows stay under the 65,535 bound-parameter cap */
export function bulkChunkSize(rows: object[]): number {
	const columns = new Set(rows.flatMap((r) => Object.keys(r))).size;
	return Math.max(1, Math.min(1000, Math.floor(65535 / Math.max(columns, 1))));
}

export function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (a instanceof RegExp && b instanceof RegExp)
		return a.source === b.source && a.flags === b.flags;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) {
		if (!Object.hasOwn(b, key)) return false;
		if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
			return false;
	}
	return true;
}

/** rows of `after` that differ from the `before` row under the same key; a key not found there changed */
export function changedRows<R>(before: Map<string, R>, after: R[], keyOf: (row: R) => string) {
	return after.filter((row) => {
		const old = before.get(keyOf(row));
		return !old || !deepEqual(old, row);
	});
}

// --- Describe / Metadata ---

/**
 * Schema details for the AI agent (#652): names only, or full detail for the
 * named tables. Never row data — Mongo samples documents but returns only the
 * inferred field types.
 */
export type SchemaDetails =
	| { tables: string[] }
	| { tables: TableDetail[] }
	| { collections: string[] }
	| { collections: CollectionDetail[] };

export type TableDetail = {
	table: string;
	columns: { name: string; type: string; nullable: boolean; default: string | null }[];
	primaryKey: string[];
	foreignKeys: { name: string; definition: string }[];
	indexes: { name: string; definition: string }[];
};

export type CollectionDetail = {
	collection: string;
	/** inferred from up to MONGO_SAMPLE documents; a field missing from some is still listed */
	fields: { name: string; type: string }[];
	indexes: { name: string; definition: string }[];
};

export type SqlRun = (sql: string, params: unknown[]) => Promise<Record<string, any>[]>;

export const MONGO_SAMPLE = 20;

// --- Transaction Errors Helpers ---

function* causes(error: unknown) {
	for (let e: any = error; e; e = e.cause) yield e;
}

/**
 * A deadlock, serialization failure or lock wait timeout: expected under
 * concurrency, and gone when the whole transaction runs again.
 */
export function isRetryableTransactionError(error: unknown): boolean {
	for (const e of causes(error)) {
		if (e.errno === "40P01" || e.errno === "40001") return true;
		if (e.errno === 1213 || e.errno === 1205) return true;
		if (typeof e.hasErrorLabel === "function" && e.hasErrorLabel("TransientTransactionError"))
			return true;
	}
	return false;
}

export const MONGO_NO_REPLICA_SET =
	"MongoDB transactions need a replica set; this server is standalone, so transaction blocks on it will fail";

export function standaloneWarning(hello: { setName?: string; msg?: string }) {
	return hello.setName || hello.msg === "isdbgrid" ? undefined : MONGO_NO_REPLICA_SET;
}

export function isTransactionUnsupported(error: unknown): boolean {
	const e = error as { code?: number; message?: string; originalError?: unknown } | null;
	if (e?.originalError) return isTransactionUnsupported(e.originalError);
	return e?.code === 20 && /Transaction numbers are only allowed/i.test(String(e.message));
}

// --- Database Adapter Contract ---

export enum DbAdapterMode {
	NORMAL = 1,
	TRANSACTION = 2,
}

export type WriteResult = { count: number; affected: any[] };

export interface DatabaseAdapter {
	/** `limit` null: every matching row */
	getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		offset: number,
		sort: DbSort[],
		options?: QueryOptions,
	): Promise<unknown[]>;
	/** get-all by cursor: the rows after `cursor.after`, and the cursor for the page after them */
	getPage(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		sort: DbSort[],
		cursor: DbCursor,
		options?: QueryOptions,
	): Promise<DbPage>;
	getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<unknown | null>;
	/** rows matching the conditions (joins included on SQL, ignored on Mongo) */
	count(table: string, conditions: DBConditionType[], options?: QueryOptions): Promise<number>;
	/** with `onConflict`: the row inserted or updated, null when `ignore` skipped it */
	insert(table: string, data: unknown, onConflict?: OnConflict): Promise<any>;
	/**
	 * `useTransaction`: all rows go in or none do; an open transaction is reused either way.
	 * With `onConflict`, rows skipped by `ignore` are left out of the result.
	 */
	insertBulk(
		table: string,
		data: unknown[],
		useTransaction?: boolean,
		onConflict?: OnConflict,
	): Promise<any>;
	/** `count` and `affected` are only the rows whose values changed, as they are after the update */
	update(table: string, data: unknown, conditions: DBConditionType[]): Promise<WriteResult>;
	raw(query?: string | unknown, params?: any[]): Promise<any>;
	/** optional — adapters that cannot describe their schema simply omit it */
	introspect?(): Promise<IntrospectedTable[]>;
	/** `affected` are the deleted rows as they were */
	delete(table: string, conditions: DBConditionType[]): Promise<WriteResult>;
	setMode(mode: DbAdapterMode): Promise<void>;
	/** `isolation` unset: the database's default. MongoDB has no levels and refuses one */
	startTransaction(isolation?: IsolationLevel): Promise<void>;
	commitTransaction(): Promise<void>;
	rollbackTransaction(): Promise<void>;
}

export type IDbAdapter = DatabaseAdapter;
export type DbAdapter = DatabaseAdapter;
