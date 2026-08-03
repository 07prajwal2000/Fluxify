import type { ReactNode } from "react";

export type JoinType = "inner" | "left" | "right" | "outer";

export interface JoinItem {
	type: JoinType;
	table: string;
	alias?: string;
	attribute: string;
}

export interface JoinsEditorProps {
	/** Field label */
	label?: string | ReactNode;
	/** Helper description */
	description?: string | ReactNode;
	/** List of joins */
	joins?: JoinItem[];
	/** Callback when joins list changes */
	onChange?: (joins: JoinItem[]) => void;
	/** Disabled state */
	isDisabled?: boolean;
	/** Readonly state alias */
	readOnly?: boolean;
	/** Autocomplete suggestions for joined table names */
	tableSuggestions?: string[];
	/** Autocomplete suggestions for columns */
	columnSuggestions?: string[];
	/** Function to get column suggestions for a specific joined table */
	getColumnSuggestions?: (tableName?: string) => string[];
	/** Additional CSS class names */
	className?: string;
	/** Empty state message */
	emptyMessage?: string;
}
