export type ConditionOperator =
	| "eq"
	| "neq"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "js"
	| "is_empty"
	| "is_not_empty";

export type ConditionChain = "and" | "or";

export type ConditionValue = string | number | boolean;

export interface Condition {
	lhs: ConditionValue;
	rhs: ConditionValue;
	operator: ConditionOperator;
	js?: string;
	chain?: ConditionChain;
}

export interface ConditionsBuilderProps {
	/** Optional field label. */
	label?: string;
	/** Optional helper description text. */
	description?: string;
	/** Whether the component is collapsible via accordion header. Default is true. */
	collapsible?: boolean;
	/** Default expanded state when collapsible is true. Default is false. */
	defaultExpanded?: boolean;
	/** Controlled expanded state. */
	isExpanded?: boolean;
	/** Callback when expanded state changes. */
	onExpandedChange?: (expanded: boolean) => void;
	/** Array of condition items. */
	conditions?: Condition[];
	/** Callback invoked when conditions change. */
	onChange?: (conditions: Condition[]) => void;
	/** If true, disables selecting the 'js' operator. */
	disableJsConditions?: boolean;
	/** List of operators to exclude from selection. */
	ignoreOperators?: ConditionOperator[];
	/** Disables editing for all fields. */
	isDisabled?: boolean;
	/** Autocomplete suggestions for LHS condition field. */
	lhsSuggestions?: string[];
	/** Autocomplete suggestions for RHS condition field. */
	rhsSuggestions?: string[];
	/** Whether to show outer border. Default is false. */
	hasBorder?: boolean;
	/** Additional CSS class names. */
	className?: string;
}
