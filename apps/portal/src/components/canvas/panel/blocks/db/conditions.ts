import type { Condition, ConditionOperator, ConditionValue } from "@fluxify/components";
import type { BlockNode } from "../../../types";

/**
 * What a stored condition can look like. The db blocks save
 * `{ attribute, value }`; the builder speaks `{ lhs, rhs }`. Both spellings are
 * accepted on read so older graphs keep loading.
 */
type RawWhereCondition = {
	attribute?: ConditionValue;
	lhs?: ConditionValue;
	value?: ConditionValue;
	rhs?: ConditionValue;
	operator?: string;
	raw?: string;
	chain?: "and" | "or";
	group?: RawWhereCondition[];
};

/** First non-empty string among the spellings a block might use for a field. */
function readString(...candidates: unknown[]): string {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate) return candidate;
	}
	return "";
}

/**
 * The connection and table a db block is bound to. Every settings tab needs
 * both to look up column suggestions, and every one of them used to re-derive
 * it with its own chain of `typeof` checks.
 */
export function readDbBinding(block: BlockNode) {
	return {
		connectionId: readString(
			block.data.connection,
			block.data.integration,
			block.data.integrationId,
		),
		tableName: readString(block.data.tableName, block.data.table),
	};
}

export function parseDbConditions(block: BlockNode): Condition[] {
	const raw = Array.isArray(block.data.conditions)
		? (block.data.conditions as RawWhereCondition[])
		: [];

	return parseList(raw);
}

// both sides pass through untouched: a tag has to survive the round trip, and
// coercing one to a string here stored "[object Object]" the next time the
// panel saved
function parseList(raw: RawWhereCondition[]): Condition[] {
	return raw.map((condition) => ({
		chain: condition.chain || "and",
		lhs: condition.attribute ?? condition.lhs ?? "",
		rhs: condition.value ?? condition.rhs ?? "",
		operator: (condition.operator as ConditionOperator) || "eq",
		raw: condition.raw,
		...(Array.isArray(condition.group) ? { group: parseList(condition.group) } : {}),
	}));
}

export function serializeDbConditions(conditions: Condition[]): Record<string, unknown>[] {
	return conditions.map((condition) =>
		// a group is only its conditions and chain; a custom condition only its text:
		// stray sides would fail the schema
		condition.group
			? { group: serializeDbConditions(condition.group), chain: condition.chain }
			: condition.operator === "raw"
				? { operator: "raw", raw: condition.raw ?? "", chain: condition.chain }
				: {
						attribute: asDbConditionSide(condition.lhs, "column"),
						value: asDbConditionSide(condition.rhs, "literal"),
						operator: condition.operator,
						chain: condition.chain,
					},
	);
}

function asDbConditionSide(value: ConditionValue, defaultKind: "column" | "literal") {
	if (value && typeof value === "object" && "kind" in value && "value" in value) {
		return value;
	}
	return { kind: defaultKind, value };
}
