import type { ConditionOperator } from "./types";

export interface OperatorOption {
	value: ConditionOperator;
	label: string;
}

export const ALL_OPERATORS: OperatorOption[] = [
	{ value: "eq", label: "=" },
	{ value: "neq", label: "!=" },
	{ value: "gt", label: ">" },
	{ value: "gte", label: ">=" },
	{ value: "lt", label: "<" },
	{ value: "lte", label: "<=" },
	{ value: "js", label: "JS" },
	{ value: "is_empty", label: "Is Empty/Null" },
	{ value: "is_not_empty", label: "Is Not Empty/Null" },
];
