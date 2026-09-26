import type { ConditionOperator } from "./types";

export interface OperatorOption {
	value: ConditionOperator;
	label: string;
	/** only a database query can run it; "mongo" narrows that to MongoDB */
	scope?: "db" | "mongo";
}

/** operators that compare against nothing, so the value input is hidden */
export const VALUELESS_OPERATORS: ConditionOperator[] = [
	"is_empty",
	"is_not_empty",
	"is_null",
	"is_not_null",
	"exists",
	"not_exists",
];

/** what the value input expects for the list operators */
export const VALUE_PLACEHOLDERS: Partial<Record<ConditionOperator, string>> = {
	in: "a, b, c",
	not_in: "a, b, c",
	between: "min, max",
};

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
	{ value: "in", label: "in", scope: "db" },
	{ value: "not_in", label: "not in", scope: "db" },
	{ value: "contains", label: "contains", scope: "db" },
	{ value: "starts_with", label: "starts with", scope: "db" },
	{ value: "ends_with", label: "ends with", scope: "db" },
	{ value: "between", label: "between", scope: "db" },
	{ value: "is_null", label: "is null", scope: "db" },
	{ value: "is_not_null", label: "is not null", scope: "db" },
	{ value: "exists", label: "exists", scope: "mongo" },
	{ value: "not_exists", label: "not exists", scope: "mongo" },
	{ value: "raw", label: "Custom" },
];
