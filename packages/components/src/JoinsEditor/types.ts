import type { ReactNode } from "react";

export type JoinType = "inner" | "left" | "right" | "full";

export interface JoinItem {
	type: JoinType;
	table: string;
	alias?: string;
	/** the ON conditions, stored as the caller's condition list */
	on?: unknown[];
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
	/** Join types to offer; all of them when left out */
	joinTypes?: JoinType[];
	/** Joins can only be removed: fields and the add button are disabled */
	locked?: boolean;
	/** The ON conditions editor for one join */
	renderConditions: (join: JoinItem, onChange: (on: unknown[]) => void) => ReactNode;
	/** Additional CSS class names */
	className?: string;
	/** Empty state message */
	emptyMessage?: string;
}
