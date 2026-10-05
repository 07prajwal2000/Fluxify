import type { Compilable } from "kysely";
import type { DBConditionType } from ".";
import {
	activeConditions,
	conditionValue,
	effectiveOperator,
	foldConditions,
	isRawCondition,
	isSqlTemplate,
	type LeafCondition,
	likePattern,
	listValue,
	rangeValue,
	textValue,
} from "./conditions";
import { type DBJoinType, isColumnRef, isLiteralRef, isNumericLike } from "./jsonPath";

/** a read: what its SQL text depends on besides the conditions, and the values bound after them */
export type CachedRead = {
	shape: unknown[];
	conditions: DBConditionType[];
	joins?: DBJoinType[];
	/** limit / offset: bound after every condition */
	tail: unknown[];
};

const MAX_SHAPES = 500;
const caches = new WeakMap<object, Map<string, string | null>>();

/**
 * Runs a read on the SQL saved for its shape; only the first read of a shape builds it (#408).
 * Reads differ in shape when their SQL text would: a skipped or null condition, a list of
 * another length, a JSON path compared to a number. Saved per pool, like the primary key, so
 * a changed integration starts empty. The first build of a shape checks that the values
 * picked here are exactly the ones the builder bound; a shape that fails is always built.
 */
export async function cachedRead(
	pool: object,
	run: (sql: string, params: readonly unknown[]) => Promise<any[]>,
	read: CachedRead,
	build: () => Compilable,
): Promise<any[]> {
	let cache = caches.get(pool);
	if (!cache) {
		cache = new Map();
		caches.set(pool, cache);
	}
	const { shape, params } = sqlBinding(read.conditions, read.joins);
	params.push(...read.tail);
	const key = JSON.stringify([read.shape, shape]);
	const saved = cache.get(key);
	if (saved) return run(saved, params);

	const query = build().compile();
	if (saved === undefined) {
		// ponytail: oldest shape out first; a graph rarely has more than a few dozen
		if (cache.size >= MAX_SHAPES) cache.delete(cache.keys().next().value as string);
		cache.set(key, Bun.deepEquals(query.parameters, params, true) ? query.sql : null);
	}
	return run(query.sql, query.parameters);
}

/** the joins' and conditions' share of the SQL text, and the values they bind, in SQL order */
export function sqlBinding(conditions: DBConditionType[], joins: DBJoinType[] = []) {
	const params: unknown[] = [];
	const shape: unknown[] = joins.map((j) => [
		j.type,
		j.table,
		j.alias,
		conditionsShape(j.on, params),
	]);
	shape.push(conditionsShape(conditions, params));
	return { shape, params };
}

function conditionsShape(conditions: DBConditionType[] | undefined, params: unknown[]): unknown {
	const active = activeConditions(conditions);
	if (!active.length) return null;
	return foldConditions<unknown>(
		active,
		(c) => leafShape(c, params),
		(chain, left, right) => [chain, left, right],
	);
}

const COMPARISONS = ["eq", "neq", "gt", "gte", "lt", "lte"];
const unwrap = (v: unknown) => (isColumnRef(v) || isLiteralRef(v) ? v.value : v);
/** all a bound value changes in the text: a list's length, a JSON path's numeric cast */
const kind = (v: unknown) => (Array.isArray(v) ? v.length : v === null ? null : isNumericLike(v));

/** mirrors toSqlExpression in conditions.ts: change one, change both */
function leafShape(c: LeafCondition, params: unknown[]): unknown {
	if (isRawCondition(c)) {
		if (!isSqlTemplate(c.raw)) return "invalid"; // the builder refuses it
		params.push(...c.raw.values);
		return c.raw.strings;
	}
	const op = effectiveOperator(c);
	// the column side; a literal attribute is bound. `sample` decides a JSON path's cast
	const lhs = (sample: unknown) => {
		if (!isLiteralRef(c.attribute)) return [c.attribute, kind(sample)];
		params.push(c.attribute.value);
		return ["literal", kind(c.attribute.value)];
	};
	if (COMPARISONS.includes(op)) {
		const left = lhs(isColumnRef(c.value) ? undefined : unwrap(c.value));
		if (isColumnRef(c.value)) return [op, left, c.value];
		const value = unwrap(c.value);
		params.push(...(Array.isArray(value) ? value : [value]));
		return [op, left, kind(value)];
	}
	switch (op) {
		case "is_null":
		case "is_not_null":
			return [op, lhs(null)];
		case "in":
		case "not_in": {
			const list = listValue(conditionValue(c), op);
			if (!list.length) return [op, 0];
			const left = lhs(list[0]);
			params.push(...list);
			return [op, left, list.length];
		}
		case "between": {
			const [min, max] = rangeValue(conditionValue(c));
			const left = lhs(min);
			params.push(min, max);
			return [op, left];
		}
		case "contains":
		case "starts_with":
		case "ends_with": {
			const left = lhs("");
			params.push(likePattern(op, textValue(conditionValue(c), op)));
			return [op, left];
		}
		default:
			return "invalid";
	}
}
