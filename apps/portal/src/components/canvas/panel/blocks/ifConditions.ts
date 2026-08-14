import type { Condition, ConditionOperator, ConditionValue } from "@fluxify/components";
import type { BlockNode } from "../../types";

const IF_OPERATORS = new Set<ConditionOperator>([
	"eq",
	"neq",
	"gt",
	"gte",
	"lt",
	"lte",
	"js",
	"is_empty",
	"is_not_empty",
]);

type IfCondition = {
	lhs: string | number | boolean;
	rhs: string | number | boolean;
	operator: ConditionOperator;
	js?: string;
	chain: "and" | "or";
};

type RawCondition = {
	attribute?: ConditionValue;
	lhs?: ConditionValue;
	value?: ConditionValue;
	rhs?: ConditionValue;
	operator?: unknown;
	js?: unknown;
	chain?: unknown;
};

function plainValue(value: unknown): string | number | boolean {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (value && typeof value === "object" && "value" in value) {
		return plainValue(value.value);
	}
	return "";
}

function operator(value: unknown): ConditionOperator {
	return IF_OPERATORS.has(value as ConditionOperator)
		? (value as ConditionOperator)
		: "eq";
}

/**
 * The shared builder also powers DB WHERE clauses, whose values may be tagged
 * column/literal references. If blocks use the server's plain lhs/rhs schema;
 * accept the old DB-shaped payload on read, then keep it out of future saves.
 */
export function parseIfConditions(block: BlockNode): Condition[] {
	const raw = Array.isArray(block.data.conditions)
		? (block.data.conditions as RawCondition[])
		: [];

	return raw.map((condition) => ({
		lhs: plainValue(condition.lhs ?? condition.attribute),
		rhs: plainValue(condition.rhs ?? condition.value),
		operator: operator(condition.operator),
		...(typeof condition.js === "string" ? { js: condition.js } : {}),
		chain: condition.chain === "or" ? "or" : "and",
	}));
}

/** Serialize only the shape validated by packages/blocks/builtin/if.ts. */
export function serializeIfConditions(conditions: Condition[]): IfCondition[] {
	return conditions.map((condition) => ({
		lhs: plainValue(condition.lhs),
		rhs: plainValue(condition.rhs),
		operator: operator(condition.operator),
		...(typeof condition.js === "string" ? { js: condition.js } : {}),
		chain: condition.chain === "or" ? "or" : "and",
	}));
}
