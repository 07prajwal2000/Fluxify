import { DB_VALUELESS_OPERATORS, type DbOperator } from "@fluxify/lib";
import { type Expression, type ExpressionBuilder, type SqlBool, sql } from "kysely";
import type { DBConditionType, RawDbCondition } from ".";
import { isColumnRef, isLiteralRef, type JsonSqlDialect, resolveCondition } from "./jsonPath";

type StructuredCondition = Exclude<DBConditionType, RawDbCondition>;

/** A custom SQL condition after the block evaluated its `{{ }}` placeholders. */
export type SqlTemplate = { strings: string[]; values: unknown[] };

export function isRawCondition(condition: DBConditionType): condition is RawDbCondition {
	return condition.operator === "raw";
}

export function isSqlTemplate(raw: unknown): raw is SqlTemplate {
	return (
		!!raw &&
		Array.isArray((raw as SqlTemplate).strings) &&
		Array.isArray((raw as SqlTemplate).values)
	);
}

const unwrap = (side: unknown) => (isColumnRef(side) || isLiteralRef(side) ? side.value : side);

/** is_null, is_not_null, exists, not_exists: they compare against nothing */
export function isValueless(operator: string) {
	return (DB_VALUELESS_OPERATORS as readonly string[]).includes(operator);
}

/**
 * The operator the adapter actually builds. `= NULL` never matches in SQL, so
 * eq/neq against null mean the null check the author obviously wanted.
 */
export function effectiveOperator(condition: StructuredCondition): DbOperator {
	if (unwrap(condition.value) === null) {
		if (condition.operator === "eq") return "is_null";
		if (condition.operator === "neq") return "is_not_null";
	}
	return condition.operator;
}

/** the value a condition compares against, refusing a column where only values make sense */
export function conditionValue(condition: StructuredCondition) {
	if (isColumnRef(condition.value)) {
		throw new Error(`${condition.operator} compares against values, not a column`);
	}
	return unwrap(condition.value);
}

/**
 * The list for in / not_in: an array, or comma-separated text from a plain
 * input. Null is refused rather than guessed at: SQL's `NOT IN (1, NULL)`
 * matches nothing while MongoDB's `$nin` still matches, so one graph would
 * answer differently per database.
 */
export function listValue(value: unknown, operator: string): unknown[] {
	const list =
		typeof value === "string"
			? value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: Array.isArray(value)
				? value
				: [value];
	if (list.some((item) => item === null || item === undefined)) {
		throw new Error(`${operator} got a null in its list; use is_null to match nulls`);
	}
	if (list.some((item) => typeof item === "object")) {
		throw new Error(`${operator} takes a list of plain values, not objects or nested lists`);
	}
	return list;
}

/** [min, max] for between, both ends included */
export function rangeValue(value: unknown): [unknown, unknown] {
	const range = listValue(value, "between");
	if (range.length !== 2) {
		throw new Error(`between needs exactly two values [min, max], got ${range.length}`);
	}
	return range as [unknown, unknown];
}

/** the text for contains / starts_with / ends_with */
export function textValue(value: unknown, operator: string): string {
	if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
		throw new Error(
			`${operator} needs text to match, got ${value === null ? "null" : typeof value}`,
		);
	}
	return String(value);
}

/** a LIKE pattern: the user's %, _ and \ are escaped so they match themselves */
function likePattern(operator: string, text: string) {
	const escaped = text.replace(/[\\%_]/g, "\\$&");
	if (operator === "starts_with") return `${escaped}%`;
	if (operator === "ends_with") return `%${escaped}`;
	return `%${escaped}%`;
}

/** the same match as a MongoDB regex, with the user's text escaped */
export function regexPattern(operator: string, text: string) {
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (operator === "starts_with") return `^${escaped}`;
	if (operator === "ends_with") return `${escaped}$`;
	return escaped;
}

/**
 * Drops every condition holding an `undefined`, so an optional filter the
 * caller never sent is simply not applied. `null` stays — it is a real value in
 * every database. The null/exists checks take no value, so only a missing
 * column skips them. If this skips all conditions of an update/delete, every
 * row is affected; that is documented and left to the graph author.
 */
export function activeConditions(conditions: DBConditionType[] = []) {
	return conditions.filter((condition) => {
		if (!isRawCondition(condition)) {
			if (unwrap(condition.attribute) === undefined) return false;
			return isValueless(condition.operator) || unwrap(condition.value) !== undefined;
		}
		if (isSqlTemplate(condition.raw)) {
			return !condition.raw.values.includes(undefined);
		}
		return condition.raw !== undefined;
	});
}

const SQL_OPERATORS: Record<string, string> = {
	eq: "=",
	neq: "<>",
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
};

function toSqlExpression(
	eb: ExpressionBuilder<any, any>,
	condition: DBConditionType,
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): Expression<SqlBool> {
	if (isRawCondition(condition)) {
		const { raw } = condition;
		if (!isSqlTemplate(raw) || raw.strings.length !== raw.values.length + 1) {
			throw new Error(
				"a custom condition on a SQL database must be SQL text, not a JavaScript filter",
			);
		}
		// parenthesised so an OR inside the user's text cannot leak into the chain
		const strings = [...raw.strings];
		strings[0] = `(${strings[0]}`;
		strings[strings.length - 1] += ")";
		// the text is the graph author's; every value is bound as a parameter
		return sql<SqlBool>(
			Object.assign(strings, { raw: strings }) as unknown as TemplateStringsArray,
			...raw.values,
		);
	}
	const operator = effectiveOperator(condition);
	if (operator in SQL_OPERATORS) {
		const { lhs, rhs } = resolveCondition(
			condition.attribute,
			condition.value,
			dialect,
			qualifiers,
		);
		return eb(lhs as never, SQL_OPERATORS[operator] as never, rhs as never);
	}
	return listOrTextExpression(eb, condition, operator, dialect, qualifiers);
}

function listOrTextExpression(
	eb: ExpressionBuilder<any, any>,
	condition: StructuredCondition,
	operator: DbOperator,
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): Expression<SqlBool> {
	// the column side only; the stand-in value decides whether a JSON path is
	// cast to a number, so `profile.score in [7, 10]` compares as numbers
	const column = (sample: unknown) =>
		resolveCondition(condition.attribute, sample, dialect, qualifiers).lhs as never;
	switch (operator) {
		case "is_null":
			return eb(column(null), "is", null);
		case "is_not_null":
			return eb(column(null), "is not", null);
		case "in":
		case "not_in": {
			const list = listValue(conditionValue(condition), operator);
			// `IN ()` is a syntax error on MySQL: an empty list decides it outright
			if (list.length === 0) return sql<SqlBool>`${sql.lit(operator === "in" ? 0 : 1)} = 1`;
			return eb(column(list[0]), operator === "in" ? "in" : "not in", list as never);
		}
		case "between": {
			const [min, max] = rangeValue(conditionValue(condition));
			return eb.between(column(min), min as never, max as never);
		}
		case "contains":
		case "starts_with":
		case "ends_with": {
			const pattern = likePattern(operator, textValue(conditionValue(condition), operator));
			// ponytail: MySQL case matching follows the column's collation (the
			// default one ignores case); wrap both sides in LOWER() if a
			// case-sensitive collation ever has to match loosely
			const lhs: unknown = column("");
			if (dialect === "mysql") {
				if (typeof lhs === "string") return eb(lhs as never, "like", pattern as never);
				// a JSON path's ->> text compares case-sensitively whatever the column's collation
				return sql<SqlBool>`lower(${lhs}) like lower(${pattern})`;
			}
			// ::text so a number or uuid column can be searched as text too
			const text = typeof lhs === "string" ? sql`${sql.ref(lhs)}::text` : sql`(${lhs})::text`;
			return eb(text as never, "ilike", pattern as never);
		}
		default:
			throw new Error(`${operator} only works on MongoDB; use is_null / is_not_null on SQL`);
	}
}

/** Applies the active conditions to a Kysely builder, chained left to right. */
export function applySqlConditions<B extends { where: Function }>(
	builder: B,
	conditions: DBConditionType[],
	dialect: JsonSqlDialect,
	qualifiers?: Set<string>,
): B {
	const active = activeConditions(conditions);
	if (active.length === 0) return builder;
	return builder.where((eb: ExpressionBuilder<any, any>) =>
		active
			.map((condition) => toSqlExpression(eb, condition, dialect, qualifiers))
			.reduce((expr, next, i) =>
				active[i].chain.toLowerCase() === "or" ? eb.or([expr, next]) : eb.and([expr, next]),
			),
	) as B;
}

/** The filter object a custom MongoDB condition returned, checked for shape. */
export function rawMongoFilter(raw: unknown): Record<string, unknown> {
	if (isSqlTemplate(raw) || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(
			"a custom condition on MongoDB must return a filter object, e.g. { age: { $gte: 18 } }",
		);
	}
	return raw as Record<string, unknown>;
}
