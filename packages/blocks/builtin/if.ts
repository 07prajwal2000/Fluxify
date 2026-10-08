import { type Condition, type ConditionGroup, conditionSchema } from "@fluxify/lib";
import { z } from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const ifBlockSchema = z
	.object({
		conditions: z.array(conditionSchema).describe("list of conditions which are evaluated"),
	})
	.extend(baseBlockDataSchema.shape);

export const ifConditionAiDescription = {
	name: BlockTypes.if,
	description:
		"Branches the flow like an IF/ELSE statement. Directs flow based on whether the condition returns TRUE or FALSE. lhs is required except for operator 'js' (put the code in 'js'); rhs is required only for eq/neq/gt/gte/lt/lte, omit it for is_empty, is_not_empty and js.",
	jsonSchema: JSON.stringify(z.toJSONSchema(ifBlockSchema)),
	output: "Its input, unchanged, on 'success' (true) or 'failure' (false).",
	example: {
		conditions: [{ lhs: "js: return input.age;", rhs: 18, operator: "gte", chain: "and" }],
	},
	// Optimized handle info with strict logical mapping
	handleInfo: `
Handles:
- 'success': Connects if the condition evaluates to TRUE (The IF branch).
- 'failure': Connects if the condition evaluates to FALSE (The ELSE branch).

Constraints:
- This block splits the flow. It does NOT have a 'source' handle.
- You must choose either 'success' or 'failure' for the connection logic.`,
};
const COMPARISONS: Record<string, string> = {
	eq: "==",
	neq: "!=",
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
};

function conditionToJs(
	condition: Exclude<Condition, ConditionGroup>,
	node: EmitNode,
	input: string,
) {
	const { lhs, rhs, operator, js } = condition;
	const operand = (raw: unknown) =>
		typeof raw === "string" && raw.startsWith("js:")
			? node.js(raw.slice(3), input)
			: JSON.stringify(raw ?? null);

	if (operator === "js") {
		const code = js ?? "";
		return `$truthy(${node.js(code.startsWith("js:") ? code.slice(3) : code, input)})`;
	}
	if (operator === "is_empty") return `$isEmpty(${operand(lhs)})`;
	if (operator === "is_not_empty") return `!$isEmpty(${operand(lhs)})`;
	return `(${operand(lhs)} ${COMPARISONS[operator]} ${operand(rhs)})`;
}

/** `undefined` for an empty group, which is dropped like the DB blocks drop it */
function foldToJs(conditions: Condition[], node: EmitNode, input: string): string | undefined {
	let expr: string | undefined;
	for (const condition of conditions) {
		const next =
			"group" in condition
				? foldToJs(condition.group, node, input)
				: conditionToJs(condition, node, input);
		if (next === undefined) continue;
		expr =
			expr === undefined ? next : `(${expr} ${condition.chain === "or" ? "||" : "&&"} ${next})`;
	}
	return expr;
}

/**
 * Strictly left to right, like the DB blocks: each condition's chain says how it
 * joins everything before it, so `a OR b AND c` is `(a || b) && c`. A group
 * folds first — brackets.
 */
export function conditionsToJs(conditions: Condition[], node: EmitNode, input: string) {
	return foldToJs(conditions, node, input) ?? "true";
}

export function emitIf(node: EmitNode) {
	const { conditions } = ifBlockSchema.parse(node.block.data);
	return `if (${conditionsToJs(conditions, node, node.in)}) {
${node.next("success")}
} else {
${node.next("failure")}
}`;
}
