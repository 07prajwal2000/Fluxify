export type ConditionOperator =
	| "eq"
	| "neq"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "js"
	| "is_empty"
	| "is_not_empty"
	// database-only, see OperatorOption.scope
	| "in"
	| "not_in"
	| "contains"
	| "starts_with"
	| "ends_with"
	| "between"
	| "is_null"
	| "is_not_null"
	| "exists"
	| "not_exists"
	/** a hand-written condition, see `Condition.raw` */
	| "raw";

/** SQL text, or JS returning a native filter object (MongoDB). */
export type CustomConditionEditor = "sql" | "js";

export type ConditionChain = "and" | "or";

/**
 * A side that names a column instead of holding a value. Tagged rather than
 * inferred from the text: a value that merely looks like a column path
 * (`ada@example.com`, `1.2.3`) is a value, and guessing from its shape is how
 * every lookup by email once compiled to a broken identifier.
 */
export interface ColumnRef {
	kind: "column";
	value: string;
}

/** The mirror: a side that holds a value where a column is the default. */
export interface LiteralRef {
	kind: "literal";
	value: string | number | boolean;
}

/**
 * Each side tags only what it is *not* by default — the left is a column, the
 * right is a literal — so an untagged side never changes meaning.
 */
export type ConditionValue = string | number | boolean | ColumnRef | LiteralRef;

export interface Condition {
	lhs: ConditionValue;
	rhs: ConditionValue;
	operator: ConditionOperator;
	js?: string;
	/**
	 * Custom condition text: SQL with `{{ expr }}` placeholders, or `js:` code
	 * returning a filter object. Only read when `operator` is "raw".
	 */
	raw?: string;
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
	/**
	 * Lets either side be switched between a column and a value. Off by default:
	 * only a database query can compare a field against another field. When on,
	 * suggestions are offered in column mode only — proposing column names while
	 * the user is typing a literal is just misleading.
	 */
	allowColumnRefs?: boolean;
	/**
	 * Offers the "Custom" operator, editing the condition by hand in this
	 * language. Hidden when unset — only database blocks know what their
	 * connection speaks.
	 */
	customConditionEditor?: CustomConditionEditor;
	/** Whether to show outer border. Default is false. */
	hasBorder?: boolean;
	/** Additional CSS class names. */
	className?: string;
}
