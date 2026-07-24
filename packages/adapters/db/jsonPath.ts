import { sql, RawBuilder } from "kysely";

export type JsonSqlDialect = "postgres" | "mysql";

type Segment = { key: string; index: boolean };

// Parses a JS-style accessor into a column + JSON path.
//   "attributes.age"   -> { column: "attributes", segments: [age] }
//   "items[0].name"    -> { column: "items", segments: [0(idx), name] }
//   "name"             -> null (plain column, no JSON access)
// A purely numeric head (e.g. the decimal string "3.14") is rejected so real
// numeric values aren't mistaken for a "3" -> "14" path.
function parsePath(
	raw: string,
): { column: string; segments: Segment[] } | null {
	const head = raw.match(/^([^.[]+)(.*)$/);
	if (!head || head[2] === "" || /^\d+$/.test(head[1])) return null;

	const rest = head[2];
	const segments: Segment[] = [];
	const re = /\.([^.[]+)|\[(\d+)\]/g;
	let m: RegExpExecArray | null;
	let consumed = 0;
	while ((m = re.exec(rest))) {
		consumed = re.lastIndex;
		if (m[1] !== undefined) segments.push({ key: m[1], index: false });
		else segments.push({ key: m[2], index: true });
	}
	// Bail on anything the accessor regex couldn't fully consume (malformed).
	if (consumed !== rest.length || segments.length === 0) return null;
	return { column: head[1], segments };
}

// Converts a JS-style accessor to a MongoDB dot-path. Mongo already addresses
// nested fields and array elements with dots ("items.0.name"), so this just
// normalizes bracket indexes into that form. Plain fields pass through.
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

export type DBJoinType = {
	table: string;
	alias?: string;
	attribute: string;
	type?: "inner" | "left" | "right" | "outer";
};

export type QueryOptions = { joins?: DBJoinType[]; columns?: string[] };

// The only shape identifiers (table/column/alias) may take. Everything routed
// into a SQL identifier position is validated against this before it reaches
// the query builder, so user-authored column/join strings can't inject SQL.
const IDENT = /^[A-Za-z_]\w*$/;
// A column reference: bare "col" or qualified "table.col".
const COLUMN_REF = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;

function assertMatch(re: RegExp, value: string, kind: string): string {
	if (!re.test(value)) throw new Error(`invalid ${kind}: ${value}`);
	return value;
}

// Set of valid SQL qualifiers for a query: the base table plus each join's
// alias (or table name when it has no alias). Used to tell "table.column" apart
// from a JSON path into a "table" column.
export function buildQualifiers(
	table: string,
	joins?: DBJoinType[],
): Set<string> {
	const set = new Set<string>([table]);
	for (const j of joins ?? []) set.add(j.alias ?? j.table);
	return set;
}

// Turns one condition operand into SQL. A JS-style JSON path becomes a real
// column expression for the dialect; a table/alias-qualified name (when its head
// is a known qualifier) becomes a plain qualified column; anything else passes
// through unchanged (LHS -> column identifier, RHS -> bound literal). castNumeric
// wraps the value so ordering works against the text a JSON extraction returns:
// Postgres errors on text-vs-number and needs ::numeric; MySQL coerces
// implicitly so none is emitted.
export function resolveJsonOperand(
	raw: unknown,
	castNumeric: boolean,
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): unknown {
	if (typeof raw !== "string") return raw;
	const parsed = parsePath(raw);
	if (!parsed) return raw;
	let { column } = parsed;
	let segments = parsed.segments;

	// Leading table/alias qualifier: first segment is the real column, the rest
	// (if any) is the JSON path. Only when the head is a declared qualifier and
	// the next hop is a key (not an array index).
	if (
		qualifiers &&
		qualifiers.has(column) &&
		segments.length > 0 &&
		!segments[0].index
	) {
		column = `${column}.${segments[0].key}`;
		segments = segments.slice(1);
	}

	// Qualified column with no JSON path -> a real typed column; no cast needed.
	if (segments.length === 0) return sql`${sql.ref(column)}`;

	if (dialect === "mysql") {
		let path = "$";
		for (const s of segments) path += s.index ? `[${s.key}]` : `.${s.key}`;
		return sql`${sql.ref(column)} ->> ${sql.lit(path)}`;
	}

	let frag: RawBuilder<unknown> = sql`${sql.ref(column)}`;
	segments.forEach((s, i) => {
		const accessor = s.index ? sql.lit(Number(s.key)) : sql.lit(s.key);
		frag =
			i === segments.length - 1
				? sql`${frag} ->> ${accessor}`
				: sql`${frag} -> ${accessor}`;
	});
	return castNumeric ? sql`(${frag})::numeric` : frag;
}

// Reusable entry point for adapters: resolves both sides of a condition. Either
// side may be a JSON path or a qualified column (the RHS can reference a column
// too); the numeric cast on one side is driven by whether the opposite operand
// looks numeric.
// ponytail: numeric cast fires only when the opposite operand is a numeric-like
// literal; JSON-path-vs-JSON-path comparisons stay text — add per-side type
// hints if numeric column-to-column JSON comparison is ever needed.
export function resolveCondition(
	attribute: string,
	value: unknown,
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): { lhs: unknown; rhs: unknown } {
	return {
		lhs: resolveJsonOperand(attribute, isNumericLike(value), dialect, qualifiers),
		rhs: resolveJsonOperand(value, isNumericLike(attribute), dialect, qualifiers),
	};
}

// Applies declared joins to a Kysely query builder. The join condition is an
// "leftRef = rightRef" ON expression (each side a bare or qualified column).
// Table, alias and both refs are identifier-validated before use.
export function applyJoins<
	QB extends {
		innerJoin: CallableFunction;
		leftJoin: CallableFunction;
		rightJoin: CallableFunction;
		fullJoin: CallableFunction;
	},
>(builder: QB, joins?: DBJoinType[]): QB {
	let qb = builder;
	for (const j of joins ?? []) {
		assertMatch(IDENT, j.table, "join table");
		const target = j.alias
			? `${j.table} as ${assertMatch(IDENT, j.alias, "join alias")}`
			: j.table;

		const parts = j.attribute.split("=");
		if (parts.length !== 2)
			throw new Error(`invalid join condition: ${j.attribute}`);
		const left = assertMatch(COLUMN_REF, parts[0].trim(), "join ref");
		const right = assertMatch(COLUMN_REF, parts[1].trim(), "join ref");

		const method =
			j.type === "left"
				? "leftJoin"
				: j.type === "right"
					? "rightJoin"
					: j.type === "outer"
						? "fullJoin"
						: "innerJoin";
		qb = (qb[method] as (...a: unknown[]) => QB).call(
			qb,
			target,
			left,
			right,
		);
	}
	return qb;
}

// Parses "expr" or "expr AS alias" for a select column. expr is one of: "*",
// "table.*", "col", "table.col". Everything is identifier-validated so the
// caller can hand the result straight to Kysely's select().
function parseColumn(raw: string): { expr: string; alias?: string } {
	const [exprRaw, aliasRaw, extra] = raw.split(/\s+as\s+/i);
	if (extra !== undefined) throw new Error(`invalid column: ${raw}`);
	const expr = exprRaw.trim();
	const alias = aliasRaw?.trim();
	if (expr !== "*" && !/^[A-Za-z_]\w*(\.(\*|[A-Za-z_]\w*))?$/.test(expr))
		throw new Error(`invalid column: ${raw}`);
	if (alias !== undefined) assertMatch(IDENT, alias, "column alias");
	return { expr, alias };
}

// Applies a select list to a Kysely query builder. Empty / "*" -> selectAll.
// "table.*" -> selectAll(table); otherwise a validated ref, optionally aliased.
export function applyColumns<
	QB extends { selectAll: CallableFunction; select: CallableFunction },
>(builder: QB, columns?: string[]): QB {
	const cols = columns ?? ["*"];
	if (cols.length === 0 || cols.includes("*")) return builder.selectAll() as QB;

	const tableStars: string[] = [];
	const refs: string[] = [];
	for (const raw of cols) {
		const { expr, alias } = parseColumn(raw);
		if (expr.endsWith(".*")) tableStars.push(expr.slice(0, -2));
		else refs.push(alias ? `${expr} as ${alias}` : expr);
	}

	let qb = builder as QB;
	if (tableStars.length) qb = qb.selectAll(tableStars) as QB;
	if (refs.length) qb = qb.select(refs) as QB;
	return qb;
}
