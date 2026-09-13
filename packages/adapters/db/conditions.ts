import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";
import type { DBConditionType, RawDbCondition } from ".";
import {
	isColumnRef,
	isLiteralRef,
	resolveCondition,
	type JsonSqlDialect,
} from "./jsonPath";

/** A custom SQL condition after the block evaluated its `{{ }}` placeholders. */
export type SqlTemplate = { strings: string[]; values: unknown[] };

export function isRawCondition(
	condition: DBConditionType,
): condition is RawDbCondition {
	return condition.operator === "raw";
}

export function isSqlTemplate(raw: unknown): raw is SqlTemplate {
	return (
		!!raw &&
		Array.isArray((raw as SqlTemplate).strings) &&
		Array.isArray((raw as SqlTemplate).values)
	);
}

const unwrap = (side: unknown) =>
	isColumnRef(side) || isLiteralRef(side) ? side.value : side;

/**
 * Drops every condition holding an `undefined`, so an optional filter the
 * caller never sent is simply not applied. `null` stays — it is a real value in
 * every database. If this skips all conditions of an update/delete, every row
 * is affected; that is documented and left to the graph author.
 */
export function activeConditions(conditions: DBConditionType[] = []) {
	return conditions.filter((condition) => {
		if (!isRawCondition(condition)) {
			return (
				unwrap(condition.attribute) !== undefined &&
				unwrap(condition.value) !== undefined
			);
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
	const { lhs, rhs } = resolveCondition(
		condition.attribute,
		condition.value,
		dialect,
		qualifiers,
	);
	return eb(
		lhs as never,
		(SQL_OPERATORS[condition.operator] ?? "=") as never,
		rhs as never,
	);
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
				active[i].chain.toLowerCase() === "or"
					? eb.or([expr, next])
					: eb.and([expr, next]),
			),
	) as B;
}

/** The filter object a custom MongoDB condition returned, checked for shape. */
export function rawMongoFilter(raw: unknown): Record<string, unknown> {
	if (
		isSqlTemplate(raw) ||
		typeof raw !== "object" ||
		raw === null ||
		Array.isArray(raw)
	) {
		throw new Error(
			"a custom condition on MongoDB must return a filter object, e.g. { age: { $gte: 18 } }",
		);
	}
	return raw as Record<string, unknown>;
}
