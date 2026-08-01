import { isJsExpression } from "../JsTextField";
import { ALL_OPERATORS } from "./constants";
import type { Condition, ConditionValue } from "./types";

function formatVal(val?: ConditionValue): string {
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
