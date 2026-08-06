import { isJsExpression } from "../JsTextField";
import { ALL_OPERATORS } from "./constants";
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
	return (
		typeof value === "object" &&
		value !== null &&
		(value as LiteralRef).kind === "literal"
	);
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
export function sideIsColumn(
	value: ConditionValue | undefined,
	side: ConditionSide,
): boolean {
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
	return sideIsColumn(value, side)
		? { kind: "literal", value: "" }
		: { kind: "column", value: "" };
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

/**
 * Formats an array of Condition objects into a readable expression summary.
 * e.g., 'status = active OR role = admin AND context.user.score > 80'
 */
export function formatConditionsSummary(conditions: Condition[]): string {
	if (!conditions || conditions.length === 0) {
		return "No conditions configured";
	}

	return conditions
		.map((c, idx) => {
			let condStr = "";
			if (c.operator === "js") {
				condStr = "js-condition";
			} else if (c.operator === "is_empty") {
				condStr = `${formatVal(c.lhs)} IS EMPTY`;
			} else if (c.operator === "is_not_empty") {
				condStr = `${formatVal(c.lhs)} IS NOT EMPTY`;
			} else {
				const opSymbol =
					ALL_OPERATORS.find((op) => op.value === c.operator)?.label || c.operator;
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
