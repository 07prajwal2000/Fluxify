import { isJsExpression } from "../JsTextField";
import { ALL_OPERATORS, VALUELESS_OPERATORS } from "./constants";
import type { ColumnRef, Condition, ConditionValue, LiteralRef } from "./types";

export function isColumnRef(value: unknown): value is ColumnRef {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as ColumnRef).kind === "column" &&
		typeof (value as ColumnRef).value === "string"
	);
}

export function isLiteralRef(value: unknown): value is LiteralRef {
	return typeof value === "object" && value !== null && (value as LiteralRef).kind === "literal";
}

/** The text behind a condition side, whichever form it is stored in. */
export function conditionText(value?: ConditionValue): string {
	if (isColumnRef(value) || isLiteralRef(value)) return String(value.value ?? "");
	return value === undefined || value === null ? "" : String(value);
}

export type ConditionSide = "lhs" | "rhs";

/**
 * Whether a side currently names a column.
 *
 * Reading tolerates an untagged side, and the two sides disagree about what
 * that means — an attribute is a column, a value is a literal. That is only a
 * back-compatibility rule for graphs written before the tags existed; anything
 * this builder writes is tagged explicitly, so the stored data never depends on
 * the reader knowing which side it came from.
 */
export function sideIsColumn(value: ConditionValue | undefined, side: ConditionSide): boolean {
	if (isColumnRef(value)) return true;
	if (isLiteralRef(value)) return false;
	return side === "lhs";
}

/**
 * What a side becomes when its mode toggle is pressed: the other mode, cleared.
 * Carrying the text over looks helpful but never is — a column name is not a
 * value, and a js expression is neither, so whatever was there is wrong in the
 * mode being switched to.
 */
export function toggleSideMode(
	value: ConditionValue | undefined,
	side: ConditionSide,
): ConditionValue {
	return sideIsColumn(value, side) ? { kind: "literal", value: "" } : { kind: "column", value: "" };
}

/**
 * Wraps freshly typed text back into whatever form the side is already in,
 * always tagged — both sides emit the same two shapes, so a consumer never has
 * to know which side a value came from to know what it means.
 */
export function encodeSide(
	text: string,
	value: ConditionValue | undefined,
	side: ConditionSide,
): ConditionValue {
	return sideIsColumn(value, side)
		? { kind: "column", value: text }
		: { kind: "literal", value: text };
}

function formatVal(val?: ConditionValue): string {
	// a column reference is never empty-quoted: it names a field, not a value
	if (isColumnRef(val)) return val.value || "''";
	if (isLiteralRef(val)) return formatVal(val.value);
	if (val === undefined || val === null || val === "") return "''";
	const text = String(val);
	if (isJsExpression(text)) return "js-expr";
	return text;
}

export function isGroup(condition: Condition): condition is Condition & { group: Condition[] } {
	return Array.isArray(condition.group);
}

/** The longest part of `path` that still leads through groups: an open group can be deleted. */
export function validPath(conditions: Condition[], path: number[]): number[] {
	const valid: number[] = [];
	let level = conditions;
	for (const index of path) {
		const item = level[index];
		if (!item || !isGroup(item)) break;
		valid.push(index);
		level = item.group;
	}
	return valid;
}

/** The list a (valid) path points at. */
export function conditionsAt(conditions: Condition[], path: number[]): Condition[] {
	return path.reduce((level, index) => level[index].group ?? [], conditions);
}

/** `conditions` with the list at `path` replaced, copying only along the path. */
export function withConditionsAt(
	conditions: Condition[],
	path: number[],
	level: Condition[],
): Condition[] {
	if (path.length === 0) return level;
	const [index, ...rest] = path;
	const next = [...conditions];
	next[index] = { ...next[index], group: withConditionsAt(next[index].group ?? [], rest, level) };
	return next;
}

const isBlankText = (value?: ConditionValue) => !conditionText(value).replace(/^js:/, "").trim();

/** How many conditions still have an empty side, counting inside groups; an empty group counts as one. */
export function countIncomplete(conditions: Condition[]): number {
	return conditions.reduce((count, c) => {
		if (isGroup(c)) return count + (c.group.length ? countIncomplete(c.group) : 1);
		if (c.operator === "raw") return count + (isBlankText(c.raw) ? 1 : 0);
		if (c.operator === "js") return count;
		const valueless =
			VALUELESS_OPERATORS.includes(c.operator) ||
			c.operator === "is_empty" ||
			c.operator === "is_not_empty";
		return count + (isBlankText(c.lhs) || (!valueless && isBlankText(c.rhs)) ? 1 : 0);
	}, 0);
}

/**
 * Formats an array of Condition objects into a readable expression summary.
 * e.g., 'status = active OR ( role = admin AND context.user.score > 80 )'
 */
export function formatConditionsSummary(conditions: Condition[]): string {
	if (!conditions || conditions.length === 0) {
		return "No conditions configured";
	}

	return conditions
		.map((c, idx) => {
			let condStr = "";
			if (isGroup(c)) {
				condStr = c.group.length ? `( ${formatConditionsSummary(c.group)} )` : "( )";
			} else if (c.operator === "js") {
				condStr = "js-condition";
			} else if (c.operator === "raw") {
				condStr = isJsExpression(c.raw) ? "custom-filter" : `(${c.raw || "''"})`;
			} else if (c.operator === "is_empty") {
				condStr = `${formatVal(c.lhs)} IS EMPTY`;
			} else if (c.operator === "is_not_empty") {
				condStr = `${formatVal(c.lhs)} IS NOT EMPTY`;
			} else if (VALUELESS_OPERATORS.includes(c.operator)) {
				condStr = `${formatVal(c.lhs)} ${c.operator.replaceAll("_", " ").toUpperCase()}`;
			} else {
				const opSymbol = ALL_OPERATORS.find((op) => op.value === c.operator)?.label || c.operator;
				condStr = `${formatVal(c.lhs)} ${opSymbol} ${formatVal(c.rhs)}`;
			}

			if (idx === 0) {
				return condStr;
			}
			const chainStr = (c.chain || "and").toUpperCase();
			return `${chainStr} ${condStr}`;
		})
		.join(" ");
}
