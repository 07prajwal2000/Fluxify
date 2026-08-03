import type { ReactNode } from "react";

export interface ArrayEditorProps {
	/** Field label */
	label?: string | ReactNode;
	/** Helper description text */
	description?: string | ReactNode;
	/** Values array */
	values?: string[];
	/** Legacy alias for values */
	array?: string[];
	/** Callback when the array changes */
	onChange?: (values: string[]) => void;
	/** Callback when a single item changes */
	onValueChange?: (index: number, value: string) => void;
	/** Callback when add button is clicked */
	onAdd?: () => void;
	/** Callback when an item is removed */
	onRemove?: (index: number) => void;
	/** Whether to show the add button (default: true) */
	showAddButton?: boolean;
	/** Label for the add button (default: "Add Item") */
	addButtonLabel?: string;
	/** Placeholder for inputs */
	placeholder?: string;
	/** If true, disables JS expressions in the inputs */
	disableJs?: boolean;
	/** Disabled state */
	isDisabled?: boolean;
	/** Readonly state alias */
	readOnly?: boolean;
	/** Additional CSS class names */
	className?: string;
	/** Empty state message */
	emptyMessage?: string;
	/** Optional list of autocomplete suggestions passed down to each item input */
	suggestions?: string[];
}
